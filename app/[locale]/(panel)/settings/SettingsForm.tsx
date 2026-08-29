"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Settings } from "@/lib/api/schemas/settings";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  EDITED_KEYS,
  READ_ONLY_STORE_KEYS,
  WRITABLE_BLOCKS,
  changedBlocks,
  fieldErrorFor,
  flagWithoutProvider,
  isDirty,
  isWritableBlock,
  storefrontConsequences,
  type SettingsDraft,
  type WritableBlock,
} from "@/lib/settings";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import {
  ErrorSummary,
  ReadOnlyField,
  SaveBar,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { Ltr } from "@/components/primitives/Ltr";
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
 *                   from the API. Rendered as **reports** — `Card` + `DataList` +
 *                   `Badge` — rather than as disabled forms: a switch that cannot
 *                   be switched is a control, and these are not controls.
 *   a key inside a
 *   writable block  `locale`, `currency`, `currency_symbol` and `logo` — which
 *                   the spec does not mention at all. It lists four writable
 *                   blocks and puts only `currency` in its read-only table;
 *                   measured, `store` publishes eight keys and accepts four.
 *                   These stay `ReadOnlyField` **in the block they belong to**:
 *                   `currency` is a fact about the store and belongs beside the
 *                   store's name, and moving it away would make the store block
 *                   look like it publishes three fields.
 *   a field this
 *   panel does not
 *   offer           `logo_id`, which needs a picker behind a second capability.
 *                   `lib/settings.ts:71-80` records why and nothing has
 *                   re-measured it, so there is no `MediaPicker` here.
 *
 * The whole form is one save. `changedBlocks()` sends only what moved — which
 * matters beyond the wire, because `settings.updated` audits `{blocks, fields}`
 * and a save that posted the whole document would record every field as changed
 * on every save (`lib/settings.ts:148-159`). §3.4's stepped-form amendment does
 * **not** apply: this is one screen of independent fields saved once, which is
 * the shape the sticky `SaveBar` was legislated for.
 *
 * ## §3.7's five states, and the two halves this screen does not have
 *
 * **One empty half only**, per §3.7-2 as amended on the media branch. There is no
 * filter, no search, no sort and no pager here — the screen takes no parameters
 * at all — so *nothing matching this filter* is a state nothing can reach, and
 * shipping it would promise a control that does not exist. **The trap is that the
 * live document looks empty**: thirteen of fourteen text fields are `""` on this
 * install. That is an empty *form*, not an empty *state*, and it renders as a
 * normal form — an `EmptyState` there would hide the controls that fix it. If a
 * control that can empty this screen is ever added, this paragraph is what has to
 * be re-read.
 *
 * **The fifth state is the offline marker and nothing else.** The document is
 * fetched once on the server and then edited here, so §3.7-5's *"any detail with
 * a refresh control **or a write**"* applies rather than the customer-detail
 * exemption beside it: the pixels can outlive the fetch, and the half of the rule
 * that does the real work has something to disable — the save bar goes off with
 * the same reason the marker gives. What this screen deliberately does **not**
 * have is a **refresh control**, and that is an argument rather than an omission:
 * a refresh on a form with unsaved edits either discards them or races them, and
 * there is no third behaviour a person would predict. The retry lives on the
 * error state, where there is no draft to lose. Staff (§17) shipped without one
 * for a weaker reason and was wrong, so this one is written down instead of
 * assumed. There is no poll either — a shop's own configuration changes when
 * somebody in the room changes it.
 *
 * **No `ConfirmDialog`.** Nothing here is destructive: no delete, no irreversible
 * act, and every save is undone by saving again.
 */
export function SettingsForm({
  locale,
  initial,
  failure,
  fetchedAt,
}: {
  locale: string;
  /** `null` when the read failed — see `page.tsx`. A 403 never reaches here. */
  initial: Settings | null;
  /** The API's own sentence, for `ErrorState.detail`. `null` for a transport failure. */
  failure: string | null;
  fetchedAt: number;
}) {
  const t = useTranslations("settings");
  const router = useRouter();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      {/*
        No back link — settings is a top-level nav route, not a detail screen —
        and no primary action: there is nothing here to create or delete, and
        §3.4 legislates a long form's save separately as the sticky bar below.
        `divided={false}` because the first card closes the block on a form page.
      */}
      <PageHeader title={t("title")} divided={false} />

      <PageBody width="form">
        {initial === null ? (
          /*
           * §3.7-4, and the split this branch exists to draw: a **403** is the
           * forbidden state and never reaches here — `page.tsx` returns it — so
           * everything that does is an error with a retry. `router.refresh()`
           * re-runs the Server Component against the same URL, which is the only
           * thing that can help, and there is no draft to lose because there is
           * no form.
           */
          <ErrorState
            message={t("unreadable")}
            detail={failure ?? undefined}
            onRetry={() => router.refresh()}
          />
        ) : (
          <SettingsDocument locale={locale} initial={initial} fetchedAt={fetchedAt} />
        )}
      </PageBody>
    </div>
  );
}

/**
 * A control's DOM id, so `ErrorSummary` can link a failure to the field it is
 * about — the whole reason every control in `Form.tsx` takes one.
 */
function fieldId(block: string, key: string): string {
  return `settings-${block}-${key}`;
}

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

/** The six cards, the one save, and the state that goes with them. */
function SettingsDocument({
  locale,
  initial,
  fetchedAt,
}: {
  locale: string;
  initial: Settings;
  fetchedAt: number;
}) {
  const t = useTranslations("settings");
  const tStates = useTranslations("states");
  const toast = useToast();
  const online = useOnline();

  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  const original = draftOf(settings);
  const dirty = isDirty(draft, original);
  const offlineReason = online ? undefined : tStates("offlineWrites");

  const set = (block: WritableBlock, key: string, value: string) =>
    setDraft((current) => ({ ...current, [block]: { ...current[block], [key]: value } }));

  async function save() {
    setSaving(true);
    setFields(null);
    setTopError(null);

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
        if (error.fields === null) setTopError(error.message);
      } else {
        setTopError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------------------------- the failures, summarised --- */

  /**
   * §3.4: a form that failed submission shows a summary at the top listing each
   * failure as a link to its field, with focus moved to it. Coupons §7's defect
   * #1 was this being absent — a 400 that rendered nowhere, which is a silent
   * failed save.
   *
   * **The API keys two levels and the dot is its own, not `next-intl`'s.** A bad
   * value is keyed `block.key` (`store.storefront_url`) and has a control on
   * screen, so it is a **link**. A whole-block complaint — an unknown key, a
   * refused read-only block — is keyed by the block alone, has no field to send
   * anybody to, and is listed as **text**, which is §3.4's own rule for an
   * orphan.
   *
   * It walks `details.fields` itself rather than asking `fieldErrorFor` and
   * `blockErrorFor` about the keys this form knows: a 400 names **every** bad
   * field including ones the form does not render, and a summary built from the
   * form's own key list would silently drop exactly those. `EDITED_KEYS` decides
   * only whether a link is honest — a refusal naming `store.logo_id`, read-only
   * here, is an orphan too rather than a link into nothing.
   */
  const failures: FormFailure[] = Object.entries(fields ?? {}).map(([key, message]) => {
    const dot = key.indexOf(".");
    const block = dot === -1 ? key : key.slice(0, dot);
    const field = dot === -1 ? null : key.slice(dot + 1);

    if (field === null) {
      return { label: t.has(`block.${block}`) ? t(`block.${block}`) : block, message };
    }

    const rendered = isWritableBlock(block) && EDITED_KEYS[block].includes(field);
    return {
      id: rendered ? fieldId(block, field) : undefined,
      label: t.has(`field.${block}_${field}`) ? t(`field.${block}_${field}`) : key,
      message,
    };
  });

  /* ------------------------------------------------------------- the report --- */

  const providers = settings.providers as {
    payment: string[];
    shipping: string[];
    marketing: string[];
  };
  const flags = settings.features as unknown as Record<string, boolean>;
  const store = settings.store as unknown as Record<string, unknown>;

  /*
   * Read from the **saved** document rather than from the draft. The three
   * consequences are true of the shop, not of what somebody has typed: a URL in
   * an unsaved field has not fixed password reset, and a warning that appeared
   * and vanished on a keystroke would be reporting the draft's state as the
   * shop's. It updates on save, because the form rebinds to the response.
   */
  const storefrontMissing = storefrontConsequences(String(store.storefront_url ?? ""));

  return (
    <div className="flex flex-col gap-4">
      {!online ? (
        <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
      ) : null}

      <ErrorSummary failures={failures} />

      {/* A failure with nothing per-field to say — a transport error, a 500, the
          empty PATCH's array. Inline and standing, never a toast: §3.1 says an
          error a person must act on is not one. */}
      {topError !== null ? (
        <Notice role="alert" tone="danger" title={tStates("errorTitle")}>
          <p className="text-ui-label">{topError}</p>
        </Notice>
      ) : null}

      {WRITABLE_BLOCKS.map((block) => (
        <Card
          key={block}
          title={t(`block.${block}`)}
          /*
            `blockNote.*` is a **description**, all six of them: every one
            explains what the block is or where its values come from, which is
            read before the fields rather than as a qualifier after them. One
            convention, held across the card set.

            **`settings.auditNote` was its duplicate and is gone.** It was a stray
            paragraph at the foot of the page saying what `blockNote.legal`
            already says one card up — "journalisé par nom de champ, jamais par
            valeur" — and its own example named the trade-register number, which
            is the block the surviving sentence sits on. §11's dashboard lesson,
            in the same words: a caveat goes on the card that needs it, and a
            second key beside the one it duplicates is removed rather than
            rendered. Restraint applies to words as much as to decoration.
          */
          description={t(`blockNote.${block}`)}
        >
          <div className="flex flex-col gap-4">
            {EDITED_KEYS[block].map((key) => (
              <Fragment key={key}>
                {key === "description" || key === "address" || key === "hours" ? (
                  <TextArea
                    id={fieldId(block, key)}
                    label={t(`field.${block}_${key}`)}
                    value={draft[block][key] ?? ""}
                    onChange={(value) => set(block, key, value)}
                    error={fieldErrorFor(fields, block, key)}
                    hint={hintFor(block, key)}
                    rows={3}
                  />
                ) : (
                  <TextField
                    id={fieldId(block, key)}
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
                )}

                {/*
                  The consequence of an empty storefront URL, **directly under
                  the field it is about** rather than four cards away at the foot
                  of the page. §11's dashboard lesson: a caveat goes on the card
                  that needs it, and this one needs its own field legible at the
                  same time.

                  It renders only when the field is actually empty — a warning
                  that is always there is a warning nobody reads — which on this
                  install is the *default* state, so `MOCK_SETTINGS=populated` is
                  where its correct absence gets photographed.
                */}
                {block === "store" && key === "storefront_url" && storefrontMissing ? (
                  <Notice tone="warning" title={t("storefrontMissing")}>
                    <ul className="list-disc space-y-0.5 ps-4 text-ui-label">
                      <li>{t("storefrontReset")}</li>
                      <li>{t("storefrontTracking")}</li>
                      <li>{t("storefrontUnsubscribe")}</li>
                    </ul>
                  </Notice>
                ) : null}
              </Fragment>
            ))}

            {block === "store" ? (
              <>
                {READ_ONLY_STORE_KEYS.map((key) => (
                  <ReadOnlyField
                    key={key}
                    label={t(`field.store_${key}`)}
                    value={<Ltr numeric={false}>{String(store[key] ?? "—")}</Ltr>}
                    reason={t(`readOnly.${key}`)}
                  />
                ))}
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
              </>
            ) : null}
          </div>
        </Card>
      ))}

      {/*
        The two blocks the API refuses, each with the reason it gives, and each a
        report rather than a disabled form. A `DataList` of label/value rows is
        what these are: a fixed set of names against states somebody glances at.
      */}
      <Card title={t("block.features")} description={t("blockNote.features")}>
        <DataList>
          {Object.entries(flags).map(([flag, enabled]) => (
            <DataRow key={flag} label={t.has(`flag.${flag}`) ? t(`flag.${flag}`) : flag}>
              {flagWithoutProvider(flag, enabled, providers) ? (
                /* The only place the gap between what the environment asked for
                   and what actually registered can show. */
                <Badge tone="warning">{t("flagOrphan")}</Badge>
              ) : (
                <Badge tone={enabled ? "success" : "neutral"}>
                  {enabled ? t("flagOn") : t("flagOff")}
                </Badge>
              )}
            </DataRow>
          ))}
        </DataList>
      </Card>

      <Card title={t("block.providers")} description={t("blockNote.providers")}>
        <DataList>
          {(["payment", "shipping", "marketing"] as const).map((registry) => (
            <DataRow key={registry} label={t(`registry.${registry}`)}>
              {providers[registry].length === 0 ? (
                <span className="text-ui-subtle">{t("noProvider")}</span>
              ) : (
                <span className="flex flex-wrap justify-end gap-1">
                  {providers[registry].map((name) => (
                    /* Nobody translates "Yalidine" — a brand keeps what its own
                       side of the wire calls it. */
                    <Badge key={name}>
                      <Ltr numeric={false}>{name}</Ltr>
                    </Badge>
                  ))}
                </span>
              )}
            </DataRow>
          ))}
        </DataList>
      </Card>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(draftOf(settings));
          setFields(null);
          setTopError(null);
        }}
        /* §3.7-5: the write control goes off with the same reason the marker
           gives, rather than failing at the network and blaming itself. */
        blockedReason={offlineReason}
      />
    </div>
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
