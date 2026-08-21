"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Segment } from "@/lib/api/schemas/campaign";
import { segmentList, segmentPreview } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  CRITERION_KIND,
  SEGMENT_CRITERIA,
  SHIPMENT_DERIVED_CRITERIA,
  hasCriteria,
  type SegmentCriterion,
} from "@/lib/campaigns";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { SelectField, TextField } from "@/components/primitives/Field";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Sheet } from "@/components/primitives/Sheet";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * Segments: stored queries, not stored membership lists.
 *
 * **The count is the screen.** A segment's criteria are three words on a row and
 * tell nobody whether it is right; "8 clients" does, and "0 clients" is the thing
 * somebody needs to see before a campaign names it. So every row carries a live
 * count from `/segments/{id}/preview` — one request each, which is affordable
 * because a shop has a handful of segments, not a page of them.
 *
 * The count needs `ac_manage_customers` on top of `ac_manage_marketing` — it is a
 * count of customers — so a Marketing Manager sees the list and not the numbers,
 * and the row says which rather than showing a zero.
 */
export function SegmentsList({
  locale,
  initialSegments,
  canCount,
}: {
  locale: string;
  initialSegments: Segment[] | null;
  canCount: boolean;
}) {
  const t = useTranslations("campaigns");
  const client = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Segment | "new" | null>(null);

  const { data, isError, error, refetch } = useQuery({
    queryKey: ["segments"],
    queryFn: async () => {
      const { data } = await acRead<unknown>("/segments?per_page=100");
      return segmentList.parse(data);
    },
    initialData: initialSegments ?? undefined,
  });

  const segments = data ?? [];

  return (
    <Scaffold
      title={t("segments")}
      back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
      trailing={
        <button
          type="button"
          onClick={() => setEditing("new")}
          aria-label={t("segment.create")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          data-testid="create-segment"
        >
          <Icon name="plus" className="size-5" />
        </button>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <p className="mb-2 px-1 text-footnote text-label-secondary" data-testid="segments-count">
          <Isolate numeric>{t("segment.count", { total: segments.length })}</Isolate>
        </p>

        {isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : segments.length === 0 ? (
          <EmptyState message={t("empty.segments")} />
        ) : (
          <ListGroup footnote={t("segment.stored")}>
            {segments.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                canCount={canCount}
                onEdit={() => setEditing(segment)}
              />
            ))}
          </ListGroup>
        )}
      </div>

      {editing !== null ? (
        <SegmentSheet
          segment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await client.invalidateQueries({ queryKey: ["segments"] });
          }}
          onDeleted={async () => {
            setEditing(null);
            await client.invalidateQueries({ queryKey: ["segments"] });
          }}
          onError={(message) => toast.show(message, "danger")}
        />
      ) : null}
    </Scaffold>
  );
}

/** One segment, with its live count. Module-level: it owns a query. */
function SegmentRow({
  segment,
  canCount,
  onEdit,
}: {
  segment: Segment;
  canCount: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("campaigns");

  const { data: preview } = useQuery({
    queryKey: ["segments", segment.id, "preview"],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/segments/${segment.id}/preview`);
      return segmentPreview.parse(data);
    },
    enabled: canCount,
  });

  const summary = Object.keys(segment.criteria)
    .filter((key): key is SegmentCriterion =>
      (SEGMENT_CRITERIA as readonly string[]).includes(key),
    )
    .map((key) => t(`criterion.${key}`))
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onEdit}
      className="list-row press-row relative flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-h-6 items-center gap-2">
          <span dir="auto" className="min-w-0 truncate text-body text-label">
            {segment.name}
          </span>
          {!segment.is_resolvable ? (
            <StatusBadge tone="danger" className="ms-auto">
              {t("segment.notResolvable")}
            </StatusBadge>
          ) : canCount && preview ? (
            /*
              **A zero is a real answer here and must look like one.** A
              `wilaya_id` segment matches nothing until an order is shipped —
              the wilaya is read off the shipment, never the address — so the
              count is tonal rather than plain: neutral when it matches somebody,
              warning when it matches nobody, which is a campaign that will be
              refused with a 409 at the send.
            */
            <StatusBadge tone={preview.matches > 0 ? "neutral" : "warning"} className="ms-auto">
              <Isolate numeric>{t("segment.matches", { count: preview.matches })}</Isolate>
            </StatusBadge>
          ) : null}
        </span>
        <span className="truncate text-footnote text-label-secondary">
          {summary === "" ? "—" : summary}
        </span>
      </span>
      <Icon name="chevron" flipInRtl className="size-4 shrink-0 text-label-tertiary" />
    </button>
  );
}

/**
 * The criteria editor.
 *
 * A row per criterion, added from a picker of the eleven the API supports — read
 * out of its own 400 rather than from documentation. **The seven refused names
 * are simply not offered**, so `consent`, `email_contains` and `sql` cannot be
 * typed and the 400s explaining them are never provoked from here.
 */
function SegmentSheet({
  segment,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  segment: Segment | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("campaigns");
  const [name, setName] = useState(segment?.name ?? "");
  const [criteria, setCriteria] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(segment?.criteria ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const used = Object.keys(criteria);
  const available = SEGMENT_CRITERIA.filter((key) => !used.includes(key));

  const save = async () => {
    setSaving(true);
    setFieldErrors({});
    try {
      /*
       * Values are sent as the API types them: money is a decimal **string**,
       * dates are `Y-m-d` strings, counts and ids are numbers. Sending a number
       * where a decimal string is expected is the kind of thing that answers 400
       * on a field nobody was looking at.
       */
      const payload = Object.fromEntries(
        Object.entries(criteria)
          .filter(([, value]) => value.trim() !== "")
          .map(([key, value]) => {
            const kind = CRITERION_KIND[key as SegmentCriterion];
            return [kind === "count" || kind === "id" ? key : key,
              kind === "count" || kind === "id" ? Number(value) : value.trim()];
          }),
      );

      if (!hasCriteria(payload)) {
        setFieldErrors({ criteria: t("segment.emptyCriteria") });
        return;
      }

      if (segment) {
        await acWrite("PATCH", `/segments/${segment.id}`, { name, criteria: payload });
      } else {
        await acWrite("POST", "/segments", { name, criteria: payload });
      }
      onSaved();
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      setFieldErrors(apiError.fields ?? {});
      if (!apiError.fields) onError(apiError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!segment) return;
    try {
      await acWrite("DELETE", `/segments/${segment.id}`);
      onDeleted();
    } catch (thrown) {
      /*
       * **A segment a campaign uses cannot be deleted**, and the 409 names how
       * many — so the API's own sentence is shown rather than a generic failure.
       */
      onError((thrown as BrowserApiError).message);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={segment ? segment.name : t("segment.create")}
      description={t("segment.stored")}
      footer={
        <div className="flex gap-3">
          <Button variant="plain" fullWidth onClick={onClose}>
            {t("sendStep.cancel")}
          </Button>
          <Button variant="filled" fullWidth loading={saving} onClick={() => void save()}>
            {t("saveAction")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-4">
        <ListGroup>
          <TextField label={t("field.name")} value={name} onChange={setName} error={fieldErrors.name} />
        </ListGroup>

        <ListGroup
          title={t("section.criteria")}
          /*
            The wilaya note, beside the criteria rather than in a help screen:
            it is read off the **shipment**, so an unshipped order has no wilaya
            and cannot match. Correct behaviour that looks exactly like a broken
            filter.
          */
          footnote={
            used.some((key) => (SHIPMENT_DERIVED_CRITERIA as readonly string[]).includes(key))
              ? t("segment.wilayaNote")
              : t("segment.consentNote")
          }
        >
          {used.length === 0 ? (
            <ListRow>
              <span className="text-footnote text-label-secondary">
                {fieldErrors.criteria ?? t("segment.emptyCriteria")}
              </span>
            </ListRow>
          ) : null}

          {used.map((key) => (
            <ListRow key={key} className="flex-col items-stretch gap-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-footnote text-label-secondary">
                  {(SEGMENT_CRITERIA as readonly string[]).includes(key)
                    ? t(`criterion.${key}`)
                    : key}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCriteria((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    })
                  }
                  aria-label={t("segment.removeCriterion")}
                  className="press flex size-8 shrink-0 items-center justify-center rounded-full text-label-secondary"
                >
                  <Icon name="close" className="size-4" />
                </button>
              </div>
              <TextField
                label={(SEGMENT_CRITERIA as readonly string[]).includes(key) ? t(`criterion.${key}`) : key}
                value={criteria[key] ?? ""}
                onChange={(value) => setCriteria((current) => ({ ...current, [key]: value }))}
                /* Money and dates are strings; counts and ids are numeric. */
                inputMode={
                  CRITERION_KIND[key as SegmentCriterion] === "date" ? "text" : "decimal"
                }
                isolate
                error={fieldErrors[key]}
              />
            </ListRow>
          ))}

          {available.length > 0 ? (
            <ListRow>
              <SelectField<string>
                label={t("segment.addCriterion")}
                value=""
                onChange={(key) =>
                  key !== "" && setCriteria((current) => ({ ...current, [key]: "" }))
                }
                options={[
                  { value: "", label: "—" },
                  ...available.map((key) => ({ value: key, label: t(`criterion.${key}`) })),
                ]}
              />
            </ListRow>
          ) : null}
        </ListGroup>

        {segment ? (
          <ListGroup footnote={t("segment.inUseDelete")}>
            <ListValueRow
              label={t("field.created")}
              value={<Ltr numeric={false}>{segment.created_at.slice(0, 10)}</Ltr>}
            />
            <ListRow>
              <Button variant="destructive" fullWidth onClick={() => void remove()}>
                {t("segment.deleteAction")}
              </Button>
            </ListRow>
          </ListGroup>
        ) : null}
      </div>
    </Sheet>
  );
}
