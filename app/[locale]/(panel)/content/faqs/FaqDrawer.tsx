"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type { Faq, FaqCategory } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import {
  CheckRow,
  ErrorSummary,
  Section,
  Select,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";

/**
 * One FAQ, in a `Drawer`.
 *
 * ## `categories`, never `category`
 *
 * The API refuses the singular **by name** — "Use \"categories\" — an FAQ may
 * sit in more than one." — which is how the field was found rather than guessed.
 * Three more are refused the same way: `title` (use `question`), `content` (use
 * `answer`) and `menu_order` (use `position`). A refusal that names its
 * replacement is worth more than a generic 400, and it is why this form binds to
 * the read body's own vocabulary.
 *
 * The writer accepts a bare list of **slugs** as well as the `{id, slug, name}`
 * objects the read emits, and this sends slugs: they are the half that survives
 * a backend re-seed, and ids are not stable.
 *
 * ## Real checkboxes
 *
 * The category rows were `<button role="checkbox">`, which announces correctly
 * and then behaves like neither a button nor a checkbox — no space-to-toggle
 * from the browser, no form association. `Form.tsx`'s `CheckRow` is a real
 * `<input type="checkbox">` stretched over the row, and it carries the count
 * *inside* the label so a screen reader reaches it.
 */
export function FaqDrawer({
  open,
  faq,
  categories,
  nextPosition,
  returnFocusTo,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` is the create form. The parent remounts on a `key`. */
  faq: Faq | null;
  categories: FaqCategory[];
  nextPosition: number;
  returnFocusTo?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("content");
  const tUi = useTranslations("ui");
  const toast = useToast();

  const [question, setQuestion] = useState(decodeEntities(faq?.question ?? ""));
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [status, setStatus] = useState<ContentStatus>(faq?.status ?? "draft");
  const [selected, setSelected] = useState<string[]>(
    faq?.categories.map((category) => category.slug) ?? [],
  );
  const [fields, setFields] = useState<Record<string, string>>({});

  const toggle = (slug: string, next: boolean) =>
    setSelected((current) =>
      next ? [...current, slug] : current.filter((value) => value !== slug),
    );

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        question,
        answer,
        status,
        position: faq?.position ?? nextPosition,
        categories: selected,
      };

      return faq === null
        ? acWrite("POST", "/cms/faqs", body)
        : acWrite("PATCH", `/cms/faqs/${faq.id}`, body);
    },
    onSuccess: () => {
      toast.show(faq === null ? t("faqs.created") : t("faqs.saved"));
      onSaved();
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError && error.fields) {
        setFields(error.fields);
        return;
      }
      if (error instanceof Error) {
        toast.show(error.message, "danger");
        return;
      }
      throw error;
    },
  });

  /* An orphan failure — a field this form does not render — is listed as text
     rather than as a link, per §3.4: there is nowhere to send the person. */
  const LABELLED: Record<string, { id: string; label: string }> = {
    question: { id: "faq-question", label: t("faqs.field.question") },
    answer: { id: "faq-answer", label: t("faqs.field.answer") },
    status: { id: "faq-status", label: t("faqs.field.status") },
  };

  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => {
    const known = LABELLED[key];
    return known === undefined ? { message } : { id: known.id, label: known.label, message };
  });

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      returnFocusTo={returnFocusTo}
      title={faq === null ? t("faqs.create") : t("faqs.edit")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {tUi("cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorSummary failures={failures} />

        <TextField
          id="faq-question"
          label={t("faqs.field.question")}
          value={question}
          onChange={setQuestion}
          error={fields.question}
        />

        <TextArea
          id="faq-answer"
          label={t("faqs.field.answer")}
          value={answer}
          onChange={setAnswer}
          rows={6}
          hint={t("faqs.field.answerHint")}
          error={fields.answer}
        />

        <Select<ContentStatus>
          id="faq-status"
          label={t("faqs.field.status")}
          value={status}
          onChange={setStatus}
          options={CONTENT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          error={fields.status}
        />

        <Section
          title={t("faqs.field.categories")}
          description={t("faqs.field.categoriesHint")}
          /* The 400 on `categories` has no control of its own to sit under — the
             refusal names the list, not a row — so it rides the group. */
          footnote={
            fields.categories ? (
              <span className="text-ui-danger-fg">{fields.categories}</span>
            ) : null
          }
        >
          {categories.length === 0 ? (
            /* A line, not a link: navigating to the categories route from inside
               an open drawer would discard whatever is typed above it. It names
               the control that is one Escape away instead. */
            <p className="px-2 py-1 text-ui-label text-ui-muted">{t("faqs.noCategories")}</p>
          ) : (
            categories.map((category) => (
              <CheckRow
                key={category.id}
                checked={selected.includes(category.slug)}
                onChange={(next) => toggle(category.slug, next)}
                label={decodeEntities(category.name)}
                count={category.count ?? null}
              />
            ))
          )}
        </Section>
      </div>
    </Drawer>
  );
}
