"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Faq, FaqCategory } from "@/lib/api/schemas/cms";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { Sheet } from "@/components/primitives/Sheet";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField, TextAreaField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";

/**
 * One FAQ.
 *
 * **`categories`, never `category`.** The API refuses the singular *by name* —
 * "Use \"categories\" — an FAQ may sit in more than one." — which is how the
 * field was found rather than guessed. Three more are refused the same way:
 * `title` (use `question`), `content` (use `answer`) and `menu_order` (use
 * `position`). A refusal that names the replacement is worth more than a
 * generic 400, and it is why this form binds to the read body's own vocabulary.
 *
 * The writer accepts a bare list of **slugs** as well as the `{id, slug, name}`
 * objects the read emits, so this sends slugs: they are the half that survives a
 * backend re-seed, and ids are not stable.
 */
export function FaqSheet({
  open,
  onOpenChange,
  faq,
  categories,
  nextPosition,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  faq: Faq | null;
  categories: FaqCategory[];
  nextPosition: number;
  onSaved: () => void;
}) {
  const t = useTranslations("content");
  const toast = useToast();

  const [question, setQuestion] = useState(decodeEntities(faq?.question ?? ""));
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [status, setStatus] = useState<ContentStatus>(faq?.status ?? "draft");
  const [selected, setSelected] = useState<string[]>(
    faq?.categories.map((category) => category.slug) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const toggle = (slug: string) =>
    setSelected((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const body = {
        question,
        answer,
        status,
        position: faq?.position ?? nextPosition,
        categories: selected,
      };

      if (faq) await acWrite("PATCH", `/cms/faqs/${faq.id}`, body);
      else await acWrite("POST", "/cms/faqs", body);

      toast.show(faq ? t("faqs.saved") : t("faqs.created"));
      onSaved();
      onOpenChange(false);
    } catch (error) {
      if (error instanceof BrowserApiError) {
        setErrors(error.fields ?? {});
        toast.show(error.message, "danger");
      } else {
        throw error;
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={faq ? t("faqs.edit") : t("faqs.create")}
      footer={
        <div className="flex items-center gap-3">
          <Button
            variant="plain"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1"
          >
            {t("cancel")}
          </Button>
          <Button variant="filled" onClick={() => void save()} loading={saving} className="flex-1">
            {t("save")}
          </Button>
        </div>
      }
    >
      <ListGroup>
        <TextField
          label={t("faqs.field.question")}
          value={question}
          onChange={setQuestion}
          error={errors.question}
        />
        <TextAreaField
          label={t("faqs.field.answer")}
          value={answer}
          onChange={setAnswer}
          error={errors.answer}
          rows={6}
          hint={t("faqs.field.answerHint")}
        />
        <SelectField<ContentStatus>
          label={t("faqs.field.status")}
          value={status}
          onChange={setStatus}
          options={CONTENT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          error={errors.status}
        />
      </ListGroup>

      <ListGroup title={t("faqs.field.categories")} footnote={t("faqs.field.categoriesHint")}>
        {categories.length === 0 ? (
          <ListRow>
            <span className="text-footnote text-label-secondary">{t("faqs.noCategories")}</span>
          </ListRow>
        ) : (
          categories.map((category) => {
            const checked = selected.includes(category.slug);
            return (
              <ListRow key={category.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(category.slug)}
                  className="flex min-h-9 w-full items-center gap-3 text-start"
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "flex size-5 shrink-0 items-center justify-center rounded-full",
                      checked ? "bg-accent text-bg" : "bg-fill",
                    ].join(" ")}
                  >
                    {checked ? <Icon name="check" className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
                    {decodeEntities(category.name)}
                  </span>
                </button>
              </ListRow>
            );
          })
        )}
        {errors.categories ? (
          <ListRow className="tone-danger tonal">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 text-footnote">{errors.categories}</span>
          </ListRow>
        ) : null}
      </ListGroup>
    </Sheet>
  );
}
