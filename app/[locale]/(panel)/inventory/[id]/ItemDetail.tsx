"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { AdjustResult, InventoryItem, Movement } from "@/lib/api/schemas/inventory";
import { BACKORDERS } from "@/lib/api/schemas/inventory";
import { STOCK_STATUSES, STOCK_TONE, type StockStatus } from "@/lib/product-status";
import { REASON_TONE } from "@/lib/movement-reason";
import { adjustTarget, displayQuantity, isDelegated, itemLabel, movementActor } from "@/lib/inventory";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { DetailGrid } from "@/components/ui/Detail";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice, StaleBanner } from "@/components/ui/States";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import {
  ErrorSummary,
  Select,
  Switch,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { AdjustForm } from "./AdjustForm";
import { itemMovementsPath } from "./query";

/**
 * One item's stock: what it holds, how to change it, how it got there.
 *
 * **The order in the main column is the order of the work**, and it survives the
 * redesign unchanged because it was right: the quantity is what someone came to
 * see, the adjustment is what they came to do, the settings are what they reach
 * for when the adjustment is refused, and the ledger is the proof underneath. A
 * settings card above the adjustment would put configuration in front of the task
 * on every visit for the sake of the visits where it is needed.
 *
 * The aside is the row's **identity** — SKU, type, the variation, its parent, the
 * id — which is fixed-height reference material a person glances at while working
 * in the main column, and which contains nothing editable. Everything the API
 * lets this screen write is in the settings card, so there is no value on this
 * page that appears twice as a control and as a display.
 *
 * ## Three flags, and they disagree on purpose
 *
 *   `manage_stock`        WooCommerce's raw value: `true`, `false`, or the
 *                         *string* `"parent"`. **Display only.**
 *   `managing_stock`      the plain yes/no. Decides whether a quantity exists at
 *                         all, and gates `canAdjust()`.
 *   `stock_managed_by_id` whose shelf actually moves. `adjustTarget()` is the
 *                         POST target and the ledger's filter.
 *
 * Conflating any two of them either 409s or moves the wrong shelf.
 */

/** The four fields `PATCH /inventory/{id}` accepts, and nothing else. */
type Settings = {
  manage_stock: boolean;
  stock_status: string;
  backorders: string;
  /**
   * A string so an empty field can mean "clear it", which the API takes as
   * `null` — the per-product threshold goes away and the store-wide setting
   * applies. Note that it never reads back empty: `wc_get_low_stock_amount()`
   * resolves the global default and the presenter publishes the *effective*
   * threshold, which is the one the row's quantity is judged against and so the
   * honest thing to show. The hint under the field says what an empty value does.
   */
  low_stock_amount: string;
};

function settingsOf(item: InventoryItem): Settings {
  return {
    /*
     * `managing_stock`, not `manage_stock` — the switch has to show the truth,
     * and the raw value is the *string* `"parent"` for a variation inheriting its
     * parent's stock.
     *
     * Which is exactly why `save()` sends only the fields that changed. Sending
     * the whole object would translate `"parent"` into `true` on any save —
     * someone edits the backorder policy and silently detaches the variation's
     * stock from its parent, with nothing on screen to say so.
     */
    manage_stock: item.managing_stock,
    stock_status: item.stock_status,
    backorders: item.backorders,
    low_stock_amount: String(item.low_stock_amount),
  };
}

/** Which settings field a 400's key belongs to, for `ErrorSummary`'s links. */
const FIELD_ID: Record<string, string> = {
  manage_stock: "settings-manage-stock",
  stock_status: "settings-stock-status",
  backorders: "settings-backorders",
  low_stock_amount: "settings-low-stock-amount",
};

export function ItemDetail({
  locale,
  initialItem,
  initialMovements,
  fetchedAt,
  meId,
}: {
  locale: string;
  initialItem: InventoryItem;
  /** `null` means the request failed. `[]` means this shelf has never moved. */
  initialMovements: Movement[] | null;
  fetchedAt: number;
  meId: number | null;
}) {
  const tDetail = useTranslations("inventory.detail");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();

  const [item, setItem] = useState(initialItem);
  const [settings, setSettings] = useState<Settings>(settingsOf(initialItem));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /*
   * §3.7's fifth state. This screen writes twice — the adjustment and the
   * settings — so the marker has something to disable, which is the half of the
   * rule that does the real work. `navigator.onLine` is trusted in one direction
   * only: it reports the interface rather than reachability, so a van's phone on
   * one bar still reads as online and only a certain absence blocks a write.
   */
  const online = useOnline();
  const writesBlocked = online ? null : tStates("offlineWrites");

  const dirty = JSON.stringify(settings) !== JSON.stringify(settingsOf(item));
  const target = adjustTarget(item);

  /**
   * This shelf's ledger, five rows.
   *
   * **Keyed and filtered on `adjustTarget(item)`, not on `item.id`** — the first
   * of the three defects this branch fixes. `lib/inventory.ts:24-27`:
   * `stock_managed_by_id` is "the id the backend writes the *movement* against …
   * so a ledger filtered by the tapped id would come back empty while the stock
   * demonstrably moved". Latent while every row in this shop self-manages;
   * fixture 9032 does not.
   *
   * Seeded from the server's fetch and refetched after an adjustment, because the
   * adjustment has just written a row that has to appear here or the screen is
   * telling two different stories about the same shelf.
   */
  const movements = useQuery({
    queryKey: ["inventory", "item-moves", target],
    queryFn: async () => {
      const { data } = await acRead<Movement[]>(itemMovementsPath(target));
      return data;
    },
    initialData: initialMovements ?? undefined,
  });

  function onAdjusted(result: AdjustResult) {
    setItem(result.item);
    setSettings(settingsOf(result.item));
    void movements.refetch();
    // The lists behind this screen now hold a stale quantity for this row.
    router.refresh();
  }

  async function save() {
    setSaving(true);
    setErrors({});
    setSaveError(null);

    /*
     * **Only what changed**, and that is not tidiness.
     *
     * `manage_stock` reads back as the string `"parent"` for a variation that
     * inherits its parent's stock, and the switch necessarily shows that as on.
     * Sending the whole object would then post `manage_stock: true` on every save
     * and quietly detach the variation from its parent — a destructive edit
     * nobody asked for, arriving as a side effect of changing the backorder
     * policy. A named subset is also what the products branch learned to send: a
     * PATCH of only read-only fields is a 400 with no `details` at all.
     *
     * `low_stock_amount` empty means "clear the per-product threshold and fall
     * back to the store-wide setting", which the API takes as `null`. Empty and
     * zero are different and both are legal — measured, the field accepts `null`,
     * `""` and any whole number of zero or more.
     */
    const original = settingsOf(item);
    const body: Record<string, unknown> = {};
    if (settings.manage_stock !== original.manage_stock) {
      body.manage_stock = settings.manage_stock;
    }
    if (settings.stock_status !== original.stock_status) {
      body.stock_status = settings.stock_status;
    }
    if (settings.backorders !== original.backorders) {
      body.backorders = settings.backorders;
    }
    if (settings.low_stock_amount !== original.low_stock_amount) {
      const raw = settings.low_stock_amount.trim();
      body.low_stock_amount = raw === "" ? null : Number(raw);
    }

    try {
      const saved = await acWrite<InventoryItem>("PATCH", `/inventory/${item.id}`, body);
      setItem(saved);
      setSettings(settingsOf(saved));
      toast.show(tDetail("saved"));
      router.refresh();
    } catch (error) {
      if (!(error instanceof BrowserApiError)) {
        setSaveError(error instanceof Error ? error.message : String(error));
        return;
      }
      const fields = error.fields;
      if (fields && Object.keys(fields).length > 0) {
        setErrors(fields);
        return;
      }
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The refusals, as `ErrorSummary` renders them.
   *
   * **A refused field this form does not render still has to be reachable**, or
   * the person reads a refusal with no cause anywhere on screen. Exactly one
   * reaches here: `stock_quantity`, whose 400 names the adjust endpoint — the
   * quantity is deliberately not settable through the settings route, which is
   * what keeps the movement ledger gapless. It has no control to link to, so §3.4
   * has it render as text rather than as a link that goes nowhere.
   */
  const failures: FormFailure[] = Object.entries(errors).map(([key, message]) => ({
    id: FIELD_ID[key],
    label: tDetail.has(`fields.${key}`) ? tDetail(`fields.${key}`) : key,
    message,
  }));

  const { product, variant } = itemLabel(item);

  return (
    <div className="flex flex-col gap-4">
      {!online ? (
        <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
      ) : null}

      {saveError !== null ? (
        <Notice role="alert" tone="danger" title={tDetail("saveFailed")}>
          <p className="text-ui-label">{saveError}</p>
        </Notice>
      ) : null}

      <ErrorSummary failures={failures} />

      <DetailGrid
        main={
          <>
            <QuantityCard item={item} locale={locale} />
            <AdjustForm item={item} onAdjusted={onAdjusted} writesBlocked={writesBlocked} />
            <SettingsCard
              settings={settings}
              errors={errors}
              dirty={dirty}
              saving={saving}
              writesBlocked={writesBlocked}
              onChange={setSettings}
              onSave={() => void save()}
              onDiscard={() => {
                setSettings(settingsOf(item));
                setErrors({});
                setSaveError(null);
              }}
            />
            <MovementsCard
              locale={locale}
              meId={meId}
              rows={movements.data}
              pending={movements.isPending}
              failed={movements.isError}
              onRetry={() => void movements.refetch()}
            />
          </>
        }
        aside={<IdentityCard item={item} locale={locale} product={product} variant={variant} />}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── what it holds ─── */

/**
 * The quantity, at `--text-display`.
 *
 * This is the number someone crossed a stockroom to read, and PRODUCT.md's scene
 * is a phone held at arm's length in bad light. It is the largest thing on the
 * page and the only thing at that size.
 *
 * **Untracked is a sentence, never a zero.** The difference between "we do not
 * count this" and "there are none" is the difference between reordering and not,
 * and 8 of the 28 top-level rows are the first. `displayQuantity()` is the only
 * way to the figure and its union is what makes reading `stock_quantity` here
 * impossible.
 *
 * A **delegated** row is a third state again: `managing_stock` is false, so there
 * is no quantity of its own, but `stock_managed_by_id` names the shelf that does
 * hold one — and that is a link, because "go and look at the parent" is the whole
 * of what a person can do here.
 */
function QuantityCard({ item, locale }: { item: InventoryItem; locale: string }) {
  const t = useTranslations("inventory");
  const tDetail = useTranslations("inventory.detail");
  const tStock = useTranslations("stockStatus");
  const quantity = displayQuantity(item);

  return (
    <Card title={tDetail("onShelf")}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {quantity.tracked ? (
            <Ltr
              className={`text-ui-display ${
                quantity.low ? "text-ui-danger-fg" : "text-ui-fg"
              }`}
            >
              {quantity.value}
            </Ltr>
          ) : (
            /* Two different absences, and the same word for both is what this
               screen must not print. `displayQuantity()` says untracked for both
               — truthfully, of *this row* — but "we do not count this" and "it is
               counted on the parent's shelf" lead to opposite actions. */
            <span className="text-ui-title text-ui-subtle">
              {isDelegated(item) ? t("delegatedShort") : t("untracked")}
            </span>
          )}

          <span className="flex flex-wrap items-center gap-2">
            {/* The state of the shelf, as a word beside its colour — §1.2. It is
                editable in the settings card below; here it is the headline
                fact, which is a display and not a second control. */}
            <Badge tone={STOCK_TONE[item.stock_status as StockStatus] ?? "neutral"}>
              {tStock(item.stock_status)}
            </Badge>
            {quantity.tracked && quantity.low ? (
              <Badge tone="danger">{t("low")}</Badge>
            ) : null}
          </span>
        </div>

        {quantity.tracked ? (
          /* The threshold is **per product** — measured 2 on 27 rows and 5 on
             one — so there is no shop-wide number to put in a legend, and the
             only place it means anything is beside the quantity it judges. */
          <p className="text-ui-label text-ui-muted">
            <Isolate>{t("threshold", { threshold: quantity.threshold })}</Isolate>
          </p>
        ) : isDelegated(item) ? (
          /* Where the quantity actually is, as a link. "Go and look at the
             parent" is the whole of what a person can do from here, and this is
             the only place on the screen that says which product that is — the
             aside deliberately does not repeat it. */
          <p className="text-ui-label text-ui-muted">
            <Link
              href={`/${locale}/inventory/${item.stock_managed_by_id}`}
              className="ui-ring rounded-ui-md text-ui-accent hover:underline"
            >
              <Isolate>{t("delegated", { id: item.stock_managed_by_id })}</Isolate>
            </Link>
          </p>
        ) : (
          <p className="text-ui-label text-ui-muted">{t("untrackedHint")}</p>
        )}
      </div>
    </Card>
  );
}

/* ──────────────────────────────────────────────────── how it is configured ─── */

/**
 * The four fields `PATCH /inventory/{id}` accepts.
 *
 * **The actions live in this card rather than in a `SaveBar`**, and that is a
 * departure from the products detail with a reason. This screen already has a
 * primary write control — the adjustment, one card above — and a sticky bar
 * reading "Enregistrer" floating over a card whose own button reads "Enregistrer
 * l'ajustement" is two saves with no way to tell which one is about to run. §3.4
 * puts a form's actions "at the bottom of the form in a bordered footer" and makes
 * the sticky version the *long form's* exception; four fields is not that, and the
 * bar's other job — keeping the save reachable — is done by the card being four
 * fields tall.
 *
 * The quantity is **not** among them and never will be: `PATCH` with
 * `stock_quantity` is a 400 naming the adjust route, which is what guarantees the
 * movement ledger has no gaps.
 */
function SettingsCard({
  settings,
  errors,
  dirty,
  saving,
  writesBlocked,
  onChange,
  onSave,
  onDiscard,
}: {
  settings: Settings;
  errors: Record<string, string>;
  dirty: boolean;
  saving: boolean;
  writesBlocked: string | null;
  onChange: (next: Settings) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("inventory");
  const tDetail = useTranslations("inventory.detail");
  const tStock = useTranslations("stockStatus");
  const tForm = useTranslations("ui.form");

  return (
    <Card title={tDetail("settings")} footnote={tDetail("settingsFootnote")}>
      <div className="flex flex-col gap-4">
        <Switch
          id={FIELD_ID.manage_stock}
          label={tDetail("manageStock")}
          hint={tDetail("manageStockHint")}
          checked={settings.manage_stock}
          onChange={(checked) => onChange({ ...settings, manage_stock: checked })}
          error={errors.manage_stock}
          disabled={saving}
        />
        <Select
          id={FIELD_ID.stock_status}
          label={tDetail("stockStatus")}
          value={settings.stock_status}
          onChange={(value) => onChange({ ...settings, stock_status: value })}
          options={STOCK_STATUSES.map((value) => ({ value, label: tStock(value) }))}
          error={errors.stock_status}
          disabled={saving}
        />
        <Select
          id={FIELD_ID.backorders}
          label={tDetail("backorders")}
          hint={tDetail("backordersHint")}
          value={settings.backorders}
          onChange={(value) => onChange({ ...settings, backorders: value })}
          options={BACKORDERS.map((value) => ({ value, label: t(`backorders.${value}`) }))}
          error={errors.backorders}
          disabled={saving}
        />
        <TextField
          id={FIELD_ID.low_stock_amount}
          label={tDetail("lowStockAmount")}
          hint={tDetail("lowStockAmountHint")}
          value={settings.low_stock_amount}
          onChange={(value) => onChange({ ...settings, low_stock_amount: value })}
          error={errors.low_stock_amount}
          inputMode="numeric"
          isolate
          disabled={saving}
        />

        {/* Only when there is something to save. A pair of buttons that is always
            there says the card is a form waiting to be submitted; this one is a
            set of values that occasionally changes. */}
        {dirty ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-ui-line pt-3">
            <p className="min-w-0 flex-1 text-ui-label text-ui-muted">{tForm("unsaved")}</p>
            <Button variant="ghost" onClick={onDiscard} disabled={saving}>
              {tForm("discard")}
            </Button>
            {/* §3.7: the write control is disabled with the same reason the stale
                marker gives, rather than failing at the network and blaming
                itself. */}
            <Button
              onClick={onSave}
              loading={saving}
              disabled={writesBlocked !== null}
              title={writesBlocked ?? undefined}
            >
              {tForm("save")}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ───────────────────────────────────────────────────────── how it got here ─── */

/**
 * The five most recent movements on this shelf.
 *
 * **An empty ledger and a failed request are different states, and this is the
 * second of the three defects this branch fixes** — one `SectionError` used to
 * serve both, reading "Aucun mouvement pour cet article." whether the shelf had
 * never moved or the request had 500'd. §3.7 requires them apart because they lead
 * to different actions: one is a fact about the shop, the other is something to
 * retry.
 *
 * A hand-rolled list rather than `DataTable`, on the order detail's precedent for
 * its line items: selection, a column picker, density, pagination and a row menu
 * are all unwanted for a fixed five-row list, and §3.2's contract is about list
 * *screens*. The whole ledger for this shelf is one link away in the header.
 *
 * No product id on these rows: every one of them names the shelf whose page the
 * reader is already on, and five lines repeating "Produit 20" under a heading
 * that says Produit 20 is noise that pushes the note off the row.
 */
function MovementsCard({
  locale,
  meId,
  rows,
  pending,
  failed,
  onRetry,
}: {
  locale: string;
  meId: number | null;
  /** `undefined` while the client is still asking — the server seed failed. */
  rows: Movement[] | undefined;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("inventory");
  const tDetail = useTranslations("inventory.detail");
  const tReason = useTranslations("movementReason");

  return (
    <Card title={tDetail("movements")}>
      {pending || rows === undefined ? (
        /* Only reachable when the server's seed failed and the client is
           retrying: with a seed there is data on first paint and this branch
           never renders. Two rows at the real line height, not a spinner. */
        <SkeletonRegion label={tDetail("movements")} className="flex flex-col">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 border-b border-ui-line py-2 last:border-b-0"
            >
              <Skeleton className="h-5 w-24 rounded-ui-md" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="ms-auto h-5 w-16" />
            </div>
          ))}
        </SkeletonRegion>
      ) : failed ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 text-ui-label text-ui-danger-fg"
        >
          <span className="min-w-0">{tDetail("movementsFailed")}</span>
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            {tDetail("movementsRetry")}
          </Button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-ui-label text-ui-muted">{tDetail("noMovements")}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((movement) => {
            const actor = movementActor(movement, meId);
            const signed =
              movement.delta > 0 ? `+${movement.delta}` : `−${Math.abs(movement.delta)}`;
            return (
              <li
                key={movement.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line py-2 last:border-b-0"
              >
                <Badge tone={REASON_TONE[movement.reason]}>{tReason(movement.reason)}</Badge>
                <span className="min-w-0 truncate text-ui-label text-ui-muted">
                  {actor.kind === "order" ? (
                    <Isolate>{t("ledger.order", { id: actor.orderId })}</Isolate>
                  ) : actor.kind === "you" ? (
                    t("ledger.you")
                  ) : actor.kind === "colleague" ? (
                    t("ledger.colleague")
                  ) : (
                    t("ledger.unknown")
                  )}
                </span>
                {/* The arrow does not flip in RTL — a fact about time, not about
                    reading direction — and both numbers travel inside the same
                    `Ltr` with it. */}
                <Ltr className="ms-auto shrink-0 text-ui-compact text-ui-fg">
                  {t("ledger.arrow", {
                    before: movement.quantity_before,
                    after: movement.quantity_after,
                  })}
                </Ltr>
                <Ltr
                  className={`shrink-0 text-ui-compact ${
                    movement.delta > 0 ? "text-ui-success-fg" : "text-ui-danger-fg"
                  }`}
                >
                  {signed}
                </Ltr>
                {/* `created_at` has no offset; `parseApiDate()` inside
                    `formatWhen` is the only thing that may touch it. `Isolate`
                    and never `Ltr` — ICU puts RTL marks inside the Arabic form. */}
                <Isolate className="shrink-0 text-ui-label text-ui-subtle">
                  {formatWhen(movement.created_at, locale)}
                </Isolate>
                {/* The operator's own words, and usually absent — 1140 of the
                    1154 rows carry `""`. It takes the whole width of a new line
                    when it is there, because it is prose and the four figures
                    above it are not. `dir="auto"` so a note typed in the other
                    language is not clipped from its front. */}
                {movement.note !== "" ? (
                  <span
                    dir="auto"
                    className="w-full min-w-0 text-ui-label text-ui-muted"
                  >
                    {movement.note}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────── the aside ─── */

/**
 * What this row *is*, as distinct from what it holds.
 *
 * Nothing here is editable, which is the aside's job on every detail screen in
 * this run: reference material glanced at while the main column is worked in. The
 * two ids are both here and they are not the same fact — `id` is the row and the
 * URL, `stock_managed_by_id` is the shelf — which is exactly the distinction that
 * makes an adjustment land in the right place.
 */
function IdentityCard({
  item,
  locale,
  product,
  variant,
}: {
  item: InventoryItem;
  locale: string;
  product: string;
  variant: string | null;
}) {
  const t = useTranslations("inventory");
  const tDetail = useTranslations("inventory.detail");

  return (
    <Card title={tDetail("identity")}>
      <DataList>
        <DataRow label={tDetail("name")}>
          <span dir="auto">{product}</span>
        </DataRow>

        {variant ? (
          <DataRow label={tDetail("variant")}>
            <span dir="auto">{variant}</span>
          </DataRow>
        ) : null}

        <DataRow label={tDetail("sku")}>
          {item.sku === "" ? (
            <span className="text-ui-subtle">{t("noSku")}</span>
          ) : (
            <Ltr numeric={false}>{item.sku}</Ltr>
          )}
        </DataRow>

        <DataRow label={tDetail("type")}>
          {t.has(`type.${item.type}`) ? t(`type.${item.type}`) : item.type}
        </DataRow>

        {item.parent_id > 0 ? (
          <DataRow label={tDetail("parent")}>
            <Link
              href={`/${locale}/inventory/${item.parent_id}`}
              className="ui-ring rounded-ui-md text-ui-accent hover:underline"
            >
              <Isolate>{t("ledger.product", { id: item.parent_id })}</Isolate>
            </Link>
          </DataRow>
        ) : null}

        {/* **No "managed by" row here**, deliberately. On every delegated row in
            this shop `stock_managed_by_id` *is* the parent, so it would be the
            same link twice within forty pixels; and the quantity card above
            already names it, which is where a reader looking for the missing
            number will be. */}

        <DataRow label={tDetail("id")}>
          <Ltr>{item.id}</Ltr>
        </DataRow>
      </DataList>
    </Card>
  );
}
