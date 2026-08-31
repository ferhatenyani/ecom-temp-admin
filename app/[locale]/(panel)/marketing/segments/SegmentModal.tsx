"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Segment } from "@/lib/api/schemas/campaign";
import { segmentPreview } from "@/lib/api/schemas/campaign";
import type { Wilaya } from "@/lib/api/schemas/order";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  CRITERION_CONTROL,
  CRITERION_KIND,
  SEGMENT_CRITERIA,
  SHIPMENT_DERIVED_CRITERIA,
  availableCriteria,
  hasCriteria,
  isSegmentCriterion,
  pairProblems,
  type SegmentCriterion,
} from "@/lib/campaigns";
import { Modal } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import { ErrorSummary, Select, TextField, type FormFailure } from "@/components/ui/Form";
import { Notice } from "@/components/ui/States";
import { Isolate } from "@/components/primitives/Ltr";
import { CriterionField } from "./CriterionField";
import { useResolvedProducts } from "./product-lookup";

/**
 * Create or edit one segment.
 *
 * ## A `Modal`, not a `Drawer`, and shipping's precedent is exact
 *
 * §3.1 gives a `Drawer` to "context beside the page" and a `Modal` to "a task
 * that must be finished or abandoned". Nothing behind this form is being read
 * from while it is filled in — the list underneath holds the same four facts this
 * dialog is editing — which is precisely what makes `CreateParcelDrawer` a drawer
 * (there the order's address is on the page behind it) and this not one.
 *
 * Size `md` (560), **and the reason it used to give for that is now false.** It
 * read "a name, at most eleven criterion rows and a picker, none of which carries
 * a long place name the way the shipping rule form's selects do" — which was true
 * of a form whose criterion values were all bare number fields and stopped being
 * true the moment `wilaya_id` became a wilaya and a product id became a product
 * name. Both are exactly the long strings that sentence said were absent.
 *
 * `md` survives anyway, on a different argument: `Listbox` truncates a long
 * option to the trigger's width and carries the full string in the accessible
 * name, so a place name cannot widen the dialog — the shipping rule form's
 * problem was never the *width*, it was two such selects side by side in one
 * row, and every row here holds one control. Verified at 1440 and at the 340px
 * floor, in both locales, with a product whose name is 27 characters.
 *
 * ## The count renders for an existing segment and is *not rendered* for a new one
 *
 * `GET /segments/{id}/preview` needs an id, so a segment that does not exist yet
 * has nothing to count — and §3.3 removes a control that cannot act rather than
 * disabling it or showing a placeholder zero. A zero would be the worst of the
 * three: on this collection it is a real and load-bearing answer (a `wilaya_id`
 * segment matches nobody until an order is *shipped*), so an invented one would
 * be indistinguishable from the fact the screen exists to show.
 *
 * The count also needs `ac_manage_customers` on top of the marketing capability —
 * it is a count of customers — so a Marketing Manager gets the sentence saying
 * whose permission it is rather than a number.
 *
 * ## The API's English is never rendered
 *
 * Three refusal shapes, and **the panel answers all three in its own words**:
 *
 *   `{}`                    `fields.name`, an English sentence about naming
 *   `{name, criteria:{}}`   `fields.criteria` plus **`details.supported`**, the
 *                           eleven as a *sibling* of `fields`
 *   `{name, criteria:{zzz}}` `fields.zzz` with the eleven **inline in the
 *                           sentence** and no `supported` key at all
 *
 * `lib/campaigns.ts` calls the eleven "a copy of a server-side constant that the
 * server itself publishes on refusal", and that is true only of the *second*
 * shape — a form that read `details.supported` after sending an unknown key would
 * find nothing there. So `supportedNames()` below prefers the published list and
 * falls back to the panel's own copy, and either way it renders the **translated
 * criterion names**, because what "surface the API's message" protects is the
 * *information* and never the provider's English. That is the sixth instance of
 * this class in the run; `ErrorSummary` keeps the API's words for a field the
 * panel has no mirror for, which is exactly `unavailableLines()`'s rule.
 */
export function SegmentModal({
  open,
  segment,
  canCount,
  wilayas,
  locale,
  canPickProducts,
  onClose,
  onSaved,
  returnFocusTo,
}: {
  open: boolean;
  /** `null` is the create form. The parent remounts on a `key`, so state seeds once. */
  segment: Segment | null;
  /** `ac_manage_customers`. Without it the count is withheld rather than zeroed. */
  canCount: boolean;
  /**
   * The 69, fetched once by the server component and prop-drilled — the shape
   * all five existing wilaya pickers already have. `[]` when that fetch failed,
   * which `WilayaCriterion` draws rather than hiding.
   */
  wilayas: readonly Wilaya[];
  locale: string;
  /** `ac_manage_coupons`. See `product-lookup.ts` for why it is not products. */
  canPickProducts: boolean;
  onClose: () => void;
  onSaved: () => void;
  returnFocusTo?: string;
}) {
  const t = useTranslations("campaigns");
  const tUi = useTranslations("ui");

  /*
   * Seeded at mount and never synchronised afterwards. The obvious version copies
   * props into state inside an effect, which React tells you not to write: it
   * cascades a second render on every open and leaves a paint of the previous
   * segment's values behind. The parent gives this a `key`, so opening a
   * different row remounts it and these initialisers run once with the right
   * values.
   */
  const [name, setName] = useState(segment?.name ?? "");
  const [criteria, setCriteria] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(segment?.criteria ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [supported, setSupported] = useState<string[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const used = Object.keys(criteria);
  const available = availableCriteria(used);

  /**
   * The two product ids this draft holds, resolved to names in **one** request.
   *
   * Hoisted here rather than fetched inside each `CriterionField`, so the two
   * product criteria share a lookup instead of asking twice — and so the id list
   * is a stable key across a re-render of the rows. `criteria` is a map, so this
   * is at most two ids and often none, and an empty list asks nothing at all.
   * `product-lookup.ts` carries the whole argument, including why the route is
   * `/coupons/eligible-products` rather than `/products`.
   */
  const productIds = SEGMENT_CRITERIA.filter(
    (key) => CRITERION_CONTROL[key] === "product",
  )
    .map((key) => Number(criteria[key]?.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  const products = useResolvedProducts(productIds, open && canPickProducts);

  /**
   * The cross-field refusals, computed here and shown before the request.
   *
   * `SegmentCriteria::checkRanges()` refuses an inverted range rather than
   * resolving it to an empty audience, and five different fields can carry the
   * verdict. Nothing in the panel knew that until this branch, so a person could
   * fill two perfect fields and earn a 400 naming one of them. `pairProblems`
   * mirrors the rule and `lib/campaigns.ts` argues it.
   *
   * The **API's** field map still outranks this: a refusal that actually
   * happened is more informative than a prediction of one, and the two agree
   * wherever both speak.
   */
  const conflicts = pairProblems(criteria);

  const preview = useQuery({
    queryKey: ["segments", segment?.id ?? 0, "preview"],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/segments/${segment?.id}/preview`);
      return segmentPreview.parse(data);
    },
    enabled: open && segment !== null && canCount,
  });

  const save = useMutation({
    mutationFn: async () => {
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
            const kind = isSegmentCriterion(key) ? CRITERION_KIND[key] : null;
            return [
              key,
              kind === "count" || kind === "id" ? Number(value) : value.trim(),
            ];
          }),
      );

      if (!hasCriteria(payload)) {
        /* Refused here rather than round-tripped, because the API's own answer to
           an empty object is the one refusal whose remedy is on *another screen*
           — "use audience_type all for that" — and the panel can say that before
           spending a request. */
        throw new BrowserApiError({
          status: 400,
          message: t("segment.emptyCriteria"),
          details: { fields: { criteria: t("segment.emptyCriteria") } },
        });
      }

      return segment === null
        ? acWrite("POST", "/segments", { name, criteria: payload })
        : acWrite("PATCH", `/segments/${segment.id}`, { name, criteria: payload });
    },
    onSuccess: () => onSaved(),
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError) {
        setFields(error.fields ?? {});
        /* A **sibling** of `fields`, and only on the empty-criteria refusal.
           `ApiError` exposes `fields` and `params` and nothing else, so this is
           read here rather than in the client. */
        const published = error.details.supported;
        setSupported(Array.isArray(published) ? published.map(String) : null);
        setRefusal(error.fields ? null : error.message);
        return;
      }
      setRefusal(error instanceof Error ? error.message : String(error));
    },
  });

  /** The eleven, published by the refusal where it publishes them and the panel's
   *  own copy where it does not — translated either way. */
  const supportedNames = () =>
    (supported ?? [...SEGMENT_CRITERIA])
      .filter((key) => isSegmentCriterion(key))
      .map((key) => t(`criterion.${key}`))
      .join(" · ");

  /**
   * One field's refusal, in the panel's own language wherever it has one.
   *
   * Three mirrors and one fall-through. The name and the two criteria shapes are
   * all mirrored; a field the panel does not recognise keeps the API's sentence,
   * which is `ErrorSummary`'s documented slot for genuinely foreign text.
   */
  const problem = (key: string): string | undefined => {
    const raw = fields[key];
    if (raw === undefined) return undefined;
    if (key === "name") return t("segment.nameRequired");
    if (key === "criteria") return t("segment.emptyCriteria");
    if (!isSegmentCriterion(key)) return t("segment.unknownCriterion", { key });
    return t(`segment.value.${CRITERION_KIND[key]}`);
  };

  /**
   * What one criterion is currently being told, API first.
   *
   * A refusal that happened outranks one this form predicts: they agree wherever
   * both speak, and where they do not it is because the shop knows something
   * this copy of its rules does not.
   */
  const criterionError = (key: SegmentCriterion): string | undefined => {
    const refused = problem(key);
    if (refused !== undefined) return refused;
    const conflict = conflicts[key];
    if (conflict === undefined) return undefined;
    return t(`segment.conflict.${conflict.rule === "same" ? "sameProduct" : "order"}`, {
      name: t(`criterion.${conflict.other}`),
    });
  };

  const labelFor = (key: string) =>
    isSegmentCriterion(key) ? t(`criterion.${key}`) : key;

  const fieldId = (key: string) => `segment-criterion-${key}`;

  const failures: FormFailure[] = Object.keys(fields).map((key) => {
    const message = problem(key) ?? fields[key];
    if (key === "name") return { id: "segment-name", label: t("columns.name"), message };
    if (key === "criteria") return { message };
    /* A criterion the form is not rendering — an unknown key stored on the record
       and then removed in this session — has nowhere to send the person, so it is
       text rather than a link. §3.4. */
    return used.includes(key)
      ? { id: fieldId(key), label: labelFor(key), message }
      : { message };
  });

  /*
   * The cross-field verdicts join the summary, and only where the API has not
   * already spoken about that field — otherwise one field would be listed twice
   * with two sentences saying the same thing. §3.4 wants every refusal on screen
   * reachable from one place, and a range this form refuses is a refusal.
   */
  for (const key of used) {
    if (!isSegmentCriterion(key) || fields[key] !== undefined) continue;
    const message = criterionError(key);
    if (message !== undefined) {
      failures.push({ id: fieldId(key), label: labelFor(key), message });
    }
  }

  const showsShipmentNote = used.some((key) =>
    (SHIPMENT_DERIVED_CRITERIA as readonly string[]).includes(key),
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={segment === null ? t("segment.create") : t("segment.edit")}
      description={t("segment.stored")}
      size="md"
      returnFocusTo={returnFocusTo}
      footer={
        <>
          {/* Cancel first in DOM order: first tab stop, and `flex-col-reverse`
              puts the primary on top on a phone where the thumb is not. */}
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {tUi("cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t("saveAction")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorSummary failures={failures} />

        {/* A refusal with no field to bind to — a 409 on a name collision, a
            network failure. §3.1: an error a person must act on is not a toast. */}
        {refusal ? (
          <Notice tone="danger" role="alert" title={refusal} />
        ) : null}

        <TextField
          id="segment-name"
          label={t("columns.name")}
          value={name}
          onChange={setName}
          hint={t("segment.nameHint")}
          error={problem("name")}
          disabled={save.isPending}
        />

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-ui-subheading text-ui-fg">{t("section.criteria")}</h3>
            <p className="mt-0.5 text-ui-label text-ui-muted">
              {/* The panel's own sentence, and the eleven named in the reader's
                  language — never the API's English. */}
              {t("segment.supportedList", { list: supportedNames() })}
            </p>
          </div>

          {used.length === 0 ? (
            <p className="text-ui-label text-ui-muted">{t("segment.emptyCriteria")}</p>
          ) : null}

          {used.map((key) => (
            <div key={key} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {/*
                  `isSegmentCriterion` is the gate, and the `else` is not
                  defensive programming. A stored segment can carry a name this
                  build has none of — `SegmentCriteria::fromStored()` drops an
                  unknown criterion with a `problems` note rather than throwing,
                  so the shop is the authority on what a record holds — and
                  `CriterionField` is typed on `SegmentCriterion`, so an unknown
                  key has no control and could not be handed one. It keeps the
                  bare field it always had, which is also the only way its value
                  survives an edit of the criteria beside it.
                */}
                {isSegmentCriterion(key) ? (
                  <CriterionField
                    criterion={key}
                    id={fieldId(key)}
                    value={criteria[key] ?? ""}
                    onChange={(value) =>
                      setCriteria((current) => ({ ...current, [key]: value }))
                    }
                    error={criterionError(key)}
                    criteria={criteria}
                    wilayas={wilayas}
                    locale={locale}
                    canPickProducts={canPickProducts}
                    resolved={products.names}
                    resolvePending={products.pending}
                    disabled={save.isPending}
                  />
                ) : (
                  <TextField
                    id={fieldId(key)}
                    label={labelFor(key)}
                    value={criteria[key] ?? ""}
                    onChange={(value) =>
                      setCriteria((current) => ({ ...current, [key]: value }))
                    }
                    hint={t("segment.unknownCriterionKept")}
                    isolate
                    error={problem(key)}
                    disabled={save.isPending}
                  />
                )}
              </div>
              {/*
                The remove button sits on the **control's** line rather than on
                the field's last one, and the empty span is what puts it there.
                `items-end` used to be enough because no criterion had a hint or
                could show a refusal in place — every one was a bare
                `TextField` — so the field ended at its input. Now four of the
                five controls carry a hint and the product one is two stacked
                fields, and `items-end` walked the button down to whatever the
                field happened to end in.

                The span reserves exactly `FieldFrame`'s label gutter — one
                `text-ui-label` line over a `gap-1.5` column, which is the
                geometry every field in `Form.tsx` is built from — so the button
                lands beside the control in all five cases and stays there when a
                refusal appears underneath. Measured against the rendered rows
                rather than reasoned about; the alternative, a hard-coded top
                margin, is a number that stops being right the day the label
                token changes.
              */}
              <div className="flex shrink-0 flex-col gap-1.5">
                {/* U+200B ZERO WIDTH SPACE, as a `\u` escape rather than as the
                    character or as an HTML numeric entity. The first is
                    `DatePicker`'s rule — an invisible codepoint in a source file
                    is one a reviewer cannot see and the next editor deletes by
                    accident — and the second is this branch's own finding: the
                    entity's four digits after its hash read as a hex colour to
                    `check-design.sh`'s scanner, which failed the tokens rule on
                    a span that carries no colour at all. */}
                <span aria-hidden="true" className="text-ui-label">
                  {"\u200B"}
                </span>
                <IconButton
                  label={t("segment.removeCriterionNamed", { name: labelFor(key) })}
                  icon="close"
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() =>
                    setCriteria((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    })
                  }
                />
              </div>
            </div>
          ))}

          {/*
            Not rendered once every criterion is in use — §3.3, a control that
            cannot act. Not rendered either once a criterion is *used*, which is
            `availableCriteria`'s job and is why a segment cannot hold two
            `min_spent`: `criteria` is a JSON object keyed by criterion name, so
            a duplicate is not something the API refuses but something the wire
            cannot express, and the draft is a `Record` for the same reason.

            **The picker offers the eleven and there is no code path to a
            twelfth.** The options come from `SEGMENT_CRITERIA`; the control each
            one is drawn with comes from `CRITERION_CONTROL`, a
            `Record<SegmentCriterion, …>` whose key set the compiler pins to
            exactly those eleven. So the eight refused by name — `consent`,
            `marketing_consent`, `email`, `email_contains`, `role`, `commune_id`,
            `limit`, `sql` — are not merely absent from a list somebody could
            extend: adding one would fail to compile for want of a control, and
            `tests/campaign-schema.test.ts` asserts the runtime half.
          */}
          {available.length > 0 ? (
            <Select<string>
              label={t("segment.addCriterion")}
              value=""
              onChange={(key) =>
                key !== "" && setCriteria((current) => ({ ...current, [key]: "" }))
              }
              options={[
                { value: "", label: t("segment.pickCriterion") },
                ...available.map((key) => ({
                  value: key as string,
                  label: t(`criterion.${key}`),
                })),
              ]}
              disabled={save.isPending}
            />
          ) : null}

          {/*
            The wilaya note, beside the criteria rather than in a help screen: it
            is read off the **shipment**, so an unshipped order has no wilaya and
            cannot match. Correct behaviour that looks exactly like a broken
            filter, which is why it is stated where somebody has just added one.
          */}
          {showsShipmentNote ? (
            <p className="text-ui-label text-ui-subtle">{t("segment.wilayaNote")}</p>
          ) : null}
        </section>

        {/*
          The count, for a segment that exists. A new one has nothing to count and
          this is **not rendered** rather than shown empty — §3.3.
        */}
        {segment !== null ? (
          <section className="flex flex-col gap-1.5 rounded-ui-md bg-ui-surface-2 px-3 py-2.5">
            <span className="text-ui-label text-ui-muted">{t("field.matches")}</span>
            {!canCount ? (
              <span className="text-ui-compact text-ui-fg">{t("segment.countHidden")}</span>
            ) : preview.isError ? (
              <span className="text-ui-compact text-ui-fg">{t("segment.countFailed")}</span>
            ) : preview.data === undefined ? (
              <span className="text-ui-compact text-ui-muted">{t("segment.counting")}</span>
            ) : (
              <>
                <span className="text-ui-heading text-ui-fg">
                  <Isolate numeric>
                    {t("segment.matches", { count: preview.data.matches })}
                  </Isolate>
                </span>
                {/*
                  **The API sends an English `note` here and the panel never
                  renders it.** "Only customers who have given marketing consent
                  are counted." is the provider's sentence; this is the panel's
                  own mirror of the same fact, which is the rule the analytics
                  branch set and the reason `segmentPreview.note` is parsed and
                  not read.
                */}
                <span className="text-ui-label text-ui-muted">
                  {t("segment.consentNote")}
                </span>
                {/* `problems` is the homepage drop report's shape and is empty on
                    a healthy segment. When it is not, the count is explained by
                    something the reader can act on. */}
                {preview.data.problems.length > 0 ? (
                  <span className="text-ui-label text-ui-warning-fg">
                    {t("segment.problems", { count: preview.data.problems.length })}
                  </span>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
