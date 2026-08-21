"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Settings } from "@/lib/api/schemas/settings";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  EDITED_KEYS,
  READ_ONLY_STORE_KEYS,
  WRITABLE_BLOCKS,
  blockErrorFor,
  changedBlocks,
  fieldErrorFor,
  flagWithoutProvider,
  isDirty,
  storefrontConsequences,
  type SettingsDraft,
  type WritableBlock,
} from "@/lib/settings";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { ReadOnlyField, TextAreaField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { useToast } from "@/components/primitives/Toast";

/**
 * The settings document as a form: four blocks that write, two that report.
 *
 * **Everything read-only carries its reason on screen**, which is
 * ADMIN_PANEL.md's requirement and its argument for it — a greyed field with no
 * explanation is a support ticket. There are three kinds of read-only here and
 * they are not the same kind:
 *
 *   a whole block   `features` and `providers`, refused by name with a sentence
 *                   from the API.
 *   a key inside a
 *   writable block  `locale`, `currency`, `currency_symbol` and `logo` — which
 *                   the spec does not mention at all. It lists four writable
 *                   blocks and puts only `currency` in its read-only table;
 *                   measured, `store` publishes eight keys and accepts four.
 *   a field this
 *   panel does not
 *   offer           `logo_id`, which needs a picker behind a second capability.
 *
 * The whole form is one save. Four blocks and nineteen fields is a settings
 * screen, not four forms, and `changedBlocks()` sends only what moved — which
 * matters beyond the wire, because `settings.updated` audits `{blocks, fields}`
 * and a save that posted the whole document would record every field as changed
 * on every save.
 */

function draftOf(settings: Settings): SettingsDraft {
  const draft = {} as SettingsDraft;

  for (const block of WRITABLE_BLOCKS) {
    const source = settings[block] as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const key of EDITED_KEYS[block]) values[key] = String(source[key] ?? "");
    draft[block] = values;
  }

  return draft;
}

export function SettingsForm({ locale, initial }: { locale: string; initial: Settings }) {
  const t = useTranslations("settings");
  const toast = useToast();

  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const original = draftOf(settings);
  const dirty = isDirty(draft, original);

  const set = (block: WritableBlock, key: string, value: string) =>
    setDraft((current) => ({ ...current, [block]: { ...current[block], [key]: value } }));

  async function save() {
    setSaving(true);
    setFields(null);
    setFailure(null);

    try {
      const written = await acWrite<Settings>("PATCH", "/settings", changedBlocks(draft, original));
      /*
       * Rebound to the response rather than to the draft. `PATCH` answers with
       * the **whole document** — verified, not assumed — so anything the API
       * normalised on the way in is what the form now holds, and the two cannot
       * drift the way a coupon's `date_expires` did.
       */
      setSettings(written);
      setDraft(draftOf(written));
      toast.show(t("saved"));
    } catch (error) {
      if (error instanceof BrowserApiError) {
        /*
         * `fields` is `null` when `details.fields` arrived as an **array**,
         * which is what the empty PATCH answers. The panel never sends that
         * request — the save bar does not appear when nothing is dirty — but
         * the getter refusing the array is what keeps `store,contact,legal,
         * social` off the screen if it ever does.
         */
        setFields(error.fields);
        if (error.fields === null) setFailure(error.message);
      } else {
        setFailure((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  const providers = settings.providers as {
    payment: string[];
    shipping: string[];
    marketing: string[];
  };
  const flags = settings.features as unknown as Record<string, boolean>;
  const store = settings.store as unknown as Record<string, unknown>;

  return (
    <Scaffold title={t("title")}>
      <div className="mx-auto max-w-3xl px-4 pb-28">
        {failure !== null ? (
          <div
            role="alert"
            className="tone-danger tonal mb-3 flex items-start gap-2 rounded-lg px-3 py-2"
          >
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 text-footnote">{failure}</span>
          </div>
        ) : null}

        {WRITABLE_BLOCKS.map((block) => (
          <ListGroup key={block} title={t(`block.${block}`)} footnote={t(`blockNote.${block}`)}>
            {blockErrorFor(fields, block) !== undefined ? (
              <ListRow className="tone-danger tonal">
                <span className="text-footnote">{blockErrorFor(fields, block)}</span>
              </ListRow>
            ) : null}

            {EDITED_KEYS[block].map((key) =>
              key === "description" || key === "address" || key === "hours" ? (
                <TextAreaField
                  key={key}
                  label={t(`field.${block}_${key}`)}
                  value={draft[block][key] ?? ""}
                  onChange={(value) => set(block, key, value)}
                  error={fieldErrorFor(fields, block, key)}
                  hint={hintFor(block, key)}
                  rows={3}
                />
              ) : (
                <TextField
                  key={key}
                  label={t(`field.${block}_${key}`)}
                  value={draft[block][key] ?? ""}
                  onChange={(value) => set(block, key, value)}
                  error={fieldErrorFor(fields, block, key)}
                  hint={hintFor(block, key)}
                  /*
                   * A trade-register number, a URL and a social handle are
                   * identifiers: they are Latin whatever the page's language,
                   * and an Arabic paragraph would otherwise reorder them.
                   */
                  isolate={IDENTIFIER_KEYS.has(key)}
                  inputMode={key === "phone" ? "text" : undefined}
                />
              ),
            )}

            {/*
              The read-only keys sit in the block they belong to rather than in a
              separate list. `currency` is a fact about the store and belongs
              beside the store's name; moving it away would make the store block
              look like it publishes four fields.
            */}
            {block === "store"
              ? READ_ONLY_STORE_KEYS.map((key) => (
                  <ReadOnlyField
                    key={key}
                    label={t(`field.store_${key}`)}
                    value={<Ltr numeric={false}>{String(store[key] ?? "—")}</Ltr>}
                    reason={t(`readOnly.${key}`)}
                  />
                ))
              : null}

            {block === "store" ? (
              <ReadOnlyField
                label={t("field.store_logo_id")}
                value={
                  Number(store.logo_id ?? 0) > 0 ? (
                    <Ltr>#{String(store.logo_id)}</Ltr>
                  ) : (
                    t("noLogo")
                  )
                }
                reason={t("readOnly.logo_id")}
              />
            ) : null}
          </ListGroup>
        ))}

        {/*
          The two blocks the API refuses, each with the reason it gives. They are
          rendered as *reports* rather than as disabled forms: a switch that
          cannot be switched is a control, and these are not controls.
        */}
        <ListGroup title={t("block.features")} footnote={t("blockNote.features")}>
          {Object.entries(flags).map(([flag, enabled]) => {
            const orphan = flagWithoutProvider(flag, enabled, providers);
            return (
              <ListRow key={flag} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
                  {t.has(`flag.${flag}`) ? t(`flag.${flag}`) : flag}
                </span>
                {orphan ? (
                  <StatusBadge tone="warning">{t("flagOrphan")}</StatusBadge>
                ) : (
                  <StatusBadge tone={enabled ? "success" : "neutral"}>
                    {enabled ? t("flagOn") : t("flagOff")}
                  </StatusBadge>
                )}
              </ListRow>
            );
          })}
        </ListGroup>

        <ListGroup title={t("block.providers")} footnote={t("blockNote.providers")}>
          {(["payment", "shipping", "marketing"] as const).map((registry) => (
            <ListRow key={registry} className="flex items-start gap-3">
              <span className="min-w-0 flex-1 text-body text-label">
                {t(`registry.${registry}`)}
              </span>
              <span className="flex min-w-0 flex-wrap justify-end gap-1">
                {providers[registry].length === 0 ? (
                  <span className="text-footnote text-label-tertiary">{t("noProvider")}</span>
                ) : (
                  providers[registry].map((name) => (
                    <StatusBadge key={name} tone="neutral">
                      <Ltr numeric={false}>{name}</Ltr>
                    </StatusBadge>
                  ))
                )}
              </span>
            </ListRow>
          ))}
        </ListGroup>

        {/*
          The consequence of an empty storefront URL, stated once at the foot
          rather than beside the field, because it is three consequences and a
          hint is one line. It renders only when the field is actually empty —
          a warning that is always there is a warning nobody reads.
        */}
        {storefrontConsequences(String(store.storefront_url ?? "")) ? (
          <div className="tone-warning tonal mb-8 rounded-lg px-4 py-3">
            <p className="text-footnote font-medium">{t("storefrontMissing")}</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-caption">
              <li>{t("storefrontReset")}</li>
              <li>{t("storefrontTracking")}</li>
              <li>{t("storefrontUnsubscribe")}</li>
            </ul>
          </div>
        ) : null}

        <p className="mb-8 px-1 text-caption text-label-tertiary">
          <Isolate>{t("auditNote")}</Isolate>
        </p>
      </div>

      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() => {
                setDraft(draftOf(settings));
                setFields(null);
                setFailure(null);
              }}
              disabled={saving}
              className="flex-1"
            >
              {t("revert")}
            </Button>
            <Button variant="filled" onClick={() => void save()} loading={saving} className="flex-1">
              {t("save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Scaffold>
  );

  function hintFor(block: WritableBlock, key: string): string | undefined {
    const messageKey = `hint.${block}_${key}`;
    return t.has(messageKey) ? t(messageKey) : undefined;
  }
}

/**
 * Fields whose value is Latin whatever the page's language.
 *
 * A URL, a trade-register number and a social handle are identifiers; a shop
 * name, an address and opening hours are prose in whichever language somebody
 * typed them, and `dir="auto"` is right for those. `email` is deliberately in
 * the first set — an address is an identifier and reordering one produces an
 * address that does not exist.
 */
const IDENTIFIER_KEYS = new Set([
  "storefront_url",
  "email",
  "phone",
  "rc",
  "nif",
  "nis",
  "ai",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
]);
