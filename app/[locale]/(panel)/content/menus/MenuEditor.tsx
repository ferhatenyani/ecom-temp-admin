"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Menu as MenuDocument, MenuItem, MenuWriteItem } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  MAX_MENU_ITEMS,
  MENU_ITEM_TYPES,
  MENU_LOCATIONS,
  isAllowedMenuUrl,
  type MenuItemType,
  type MenuLocation,
} from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FilterTabs } from "@/components/ui/FilterBar";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Modal, useLatchedOpener } from "@/components/ui/Overlay";
import { Reorder, moveItem } from "@/components/ui/Reorder";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ErrorSummary, SaveBar, Select, TextField, type FormFailure } from "@/components/ui/Form";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * The navigation menus.
 *
 * ## Two vocabularies for one thing
 *
 * `CmsPresenter::menu()` has published **WordPress's** shape since §61 — `type`
 * is `post_type` with `object: "page"`, and the label is `title` rather than
 * `label` — while §89 specified the writer in the shop's own vocabulary
 * (`type: "page"`, `label`). `MenuInput` normalises both, so a read body PUTs
 * back unchanged and that round trip is asserted on the backend.
 *
 * This editor relies on that rather than translating: an untouched item is sent
 * back in the shape it arrived in, carrying its `object_id`, and only the fields
 * a person actually edited are rewritten. Measured on `menuTarget()`: for a page
 * item, `path` wins when it is non-empty and `object_id` is used and validated
 * otherwise — so an existing page item needs no path and a newly-added one is
 * addressed by the path somebody typed.
 *
 * ## An unassigned location is an empty state, not an error
 *
 * `GET /cms/menus/footer` is a **404 with its own message** — "No menu is
 * assigned to that location." — which is a different fact from a location that
 * was never registered, and this screen says which. `PUT` to that location then
 * **creates and assigns** the menu: measured, it answered 200 having created
 * "Footer navigation". So the empty state carries a working action rather than a
 * dead end, and the 404 never reaches the error state.
 *
 * ## The location is a `FilterTabs` in the default `tabs` variant
 *
 * Not a filter and not a range: it is *which document am I editing*, which is the
 * panel-wide meaning of a full-bleed underlined strip under the header. The
 * analytics branch settled that in one sentence — a labelled chip group always
 * means the window, this strip always means the view — and a menu location is a
 * view. It replaces a `Segmented`, which DESIGN.md §0 retires.
 *
 * ## `key={location}` is what stops one location's edits landing on another's
 *
 * The draft below is seeded with `useState`, and a draft seeded from data that
 * arrives *later* is the case an effect would have to patch up — which is both a
 * cascading render and, worse, wrong: switching location while a tree is
 * half-edited would leave one location's edits sitting over another's menu. A
 * new location is a new component with its own state, so the draft cannot outlive
 * the menu it belongs to and nothing has to remember to clear it.
 */

type Editable = {
  key: string;
  label: string;
  kind: MenuItemType;
  url: string;
  path: string;
  objectId: number | null;
  children: Editable[];
};

let counter = 0;
const nextKey = () => `item-${(counter += 1)}`;

/** WordPress's read vocabulary, normalised to the writer's four types. */
function kindOf(item: MenuItem): MenuItemType {
  if (item.type === "custom") return "url";
  if (item.type === "post_type" && item.object === "page") return "page";
  if (item.type === "post_type" && item.object === "product") return "product";
  if (item.type === "taxonomy" && item.object === "product_cat") return "category";
  // Anything else is a WordPress item this API has no type for. `url` keeps its
  // destination intact rather than dropping the row.
  return "url";
}

function editableOf(item: MenuItem): Editable {
  return {
    key: nextKey(),
    label: decodeEntities(item.title),
    kind: kindOf(item),
    url: item.url,
    path: "",
    objectId: item.object_id > 0 ? item.object_id : null,
    children: item.children.map(editableOf),
  };
}

function writeItem(item: Editable): MenuWriteItem {
  const base = {
    label: item.label,
    type: item.kind,
    children: item.children.map(writeItem),
  };

  if (item.kind === "url") return { ...base, url: item.url };
  // A path only when somebody typed one; otherwise the id the read supplied,
  // which `menuTarget()` validates.
  if (item.kind === "page" && item.path !== "") return { ...base, path: item.path };
  return { ...base, object_id: item.objectId ?? 0 };
}

function countItems(items: Editable[]): number {
  return items.reduce((total, item) => total + 1 + countItems(item.children), 0);
}

const itemOpenerId = (path: number[]) => `menu-item-${path.join("-")}`;
const itemMenuId = (path: number[]) => `menu-item-menu-${path.join("-")}`;

export function MenuEditor({
  locale,
  initialLocation,
}: {
  locale: string;
  initialLocation: MenuLocation;
}) {
  const t = useTranslations("content");
  const router = useRouter();
  const searchParams = useSearchParams();

  const raw = searchParams.get("location") ?? "";
  const location: MenuLocation = (MENU_LOCATIONS as readonly string[]).includes(raw)
    ? (raw as MenuLocation)
    : initialLocation;

  const { data, isPending, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["cms", "menu", location],
    queryFn: async () => {
      try {
        const { data: menu } = await acRead<MenuDocument>(`/cms/menus/${location}`);
        return menu;
      } catch (caught) {
        // The 404 is a *state*, not a failure: no menu is assigned here yet, and
        // a PUT will create one. Anything else is a real error.
        if (caught instanceof BrowserApiError && caught.status === 404) return null;
        throw caught;
      }
    },
  });

  const tabs = (
    <FilterTabs<MenuLocation>
      tabs={MENU_LOCATIONS.map((value) => ({
        value,
        label: t(`menus.location.${value}`),
      }))}
      value={location}
      onChange={(next) =>
        router.push(`/${locale}/content/menus?location=${next}`, { scroll: false })
      }
      label={t("menus.locationLabel")}
    />
  );

  // The location control stays live while the menu loads or fails, so a person
  // who landed on a broken location can move off it without a back button.
  if (isPending || isError) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("section.menus")}
          subtitle={isPending ? t("loading") : undefined}
          back={{ href: `/${locale}/content`, label: t("title") }}
          toolbar={tabs}
        />
        <PageBody width="detail">
          {isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : (
            <CardSkeleton rows={5} label={t("loading")} titled={false} footnote={1} />
          )}
        </PageBody>
      </div>
    );
  }

  return (
    <MenuDraft
      key={location}
      locale={locale}
      location={location}
      menu={data ?? null}
      tabs={tabs}
      fetchedAt={dataUpdatedAt}
    />
  );
}

function MenuDraft({
  locale,
  location,
  menu,
  tabs,
  fetchedAt,
}: {
  locale: string;
  location: MenuLocation;
  /** Null when no menu is assigned to this location — a state, not a failure. */
  menu: MenuDocument | null;
  tabs: ReactNode;
  fetchedAt: number;
}) {
  const t = useTranslations("content");
  const tStates = useTranslations("states");
  const toast = useToast();

  const [items, setItems] = useState<Editable[]>(() => (menu?.items ?? []).map(editableOf));
  /*
   * The baseline is the **array**, not a hash of it.
   *
   * "Rétablir" used to call `refetch()`, which updated the query and did nothing
   * to the draft: `MenuDraft` seeds its state at mount and its `key` is the
   * location, so a refetch of the same location never remounts it and the
   * initialiser never runs again. The button was inert. Discarding is a local
   * act — put back what was read — so it is a local array.
   */
  const [baseline, setBaseline] = useState<Editable[]>(() =>
    (menu?.items ?? []).map(editableOf),
  );
  const [editing, setEditing] = useState<{ path: number[]; item: Editable } | null>(null);
  const [adding, setAdding] = useState<{ parent: number | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const confirmRemove = useConfirm<{ path: number[]; label: string }>();

  const online = useOnline();

  const removeOpener = useLatchedOpener(
    confirmRemove.target && itemMenuId(confirmRemove.target.path),
  );
  const modalOpener = useLatchedOpener(
    editing ? itemOpenerId(editing.path) : adding ? "menu-add" : null,
  );

  const dirty = JSON.stringify(items.map(stripKeys)) !== JSON.stringify(baseline.map(stripKeys));
  const total = countItems(items);
  const atCap = total >= MAX_MENU_ITEMS;

  const save = useMutation({
    mutationFn: () =>
      acWrite<MenuDocument>("PUT", `/cms/menus/${location}`, {
        items: items.map(writeItem),
      }),
    onMutate: () => setFieldErrors({}),
    onSuccess: (saved) => {
      /* Re-seed from the response: the writer normalises both vocabularies, so
         what comes back is the stored shape rather than the one that went out. */
      const fresh = saved.items.map(editableOf);
      setItems(fresh);
      setBaseline(fresh);
      toast.show(t("menus.saved"));
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError && caught.fields) {
        setFieldErrors(caught.fields);
        return;
      }
      if (caught instanceof Error) {
        toast.show(caught.message, "danger");
        return;
      }
      throw caught;
    },
  });

  const updateAt = (path: number[], updater: (item: Editable) => Editable) =>
    setItems((tree) => applyAt(tree, path, updater));

  /**
   * A refusal, as the summary renders it.
   *
   * **Errors are positional through the tree** — `items[0].url`,
   * `items[1].children[0].object_id` — and the control they belong to may be two
   * levels down inside a `Modal` that is not open, so they cannot be bound to a
   * field the way a flat form's are. What *is* always on screen is the row: the
   * link therefore targets the item's own opener, which is the control that opens
   * the field. That is §3.4's "a link to its field" honoured through one hop
   * rather than abandoned.
   *
   * The label is the item's **position**, not the API's key: `items[1].children[0]`
   * rendered raw is a bracketed LTR run inside an Arabic sentence, and the
   * summary interpolates it into a translated string where it cannot be
   * `Ltr`-wrapped. A path this parser does not recognise falls through to the
   * message alone — §3.4's orphan rule — rather than putting the raw key on
   * screen.
   */
  const failures: FormFailure[] = Object.entries(fieldErrors).map(([field, message]) => {
    const top = field.match(/^items\[(\d+)\]/);
    if (!top) return { message };

    const child = field.match(/^items\[(\d+)\]\.children\[(\d+)\]/);
    const path = child
      ? [Number.parseInt(child[1], 10), Number.parseInt(child[2], 10)]
      : [Number.parseInt(top[1], 10)];

    return {
      id: itemOpenerId(path),
      label: t("menus.itemAt", { position: path.map((n) => n + 1).join(".") }),
      message,
    };
  });

  const unassigned = menu === null && items.length === 0;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.menus")}
        subtitle={
          <span data-testid="menu-count">
            <Isolate>{t("menus.count", { total, max: MAX_MENU_ITEMS })}</Isolate>
          </span>
        }
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <Button
            id="menu-add"
            icon="plus"
            onClick={() => setAdding({ parent: null })}
            disabled={atCap}
            title={atCap ? t("menus.atCap", { max: MAX_MENU_ITEMS }) : undefined}
          >
            {t("menus.add")}
          </Button>
        }
        toolbar={tabs}
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {/* §3.7: the marker where the pixels can outlive the fetch — this holds
              a react-query cache and it writes — and the write control disabled
              with the same reason, which is the half of the rule nothing in this
              panel had a screen to apply it on until now. */}
          {!online && fetchedAt > 0 ? (
            <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
          ) : null}

          <ErrorSummary failures={failures} />

          {unassigned ? (
            /* Distinct from "the menu is empty" and from "that location does not
               exist", and the action works: a PUT creates and assigns one. */
            <EmptyState
              icon="list"
              message={t("menus.unassigned")}
              detail={t("menus.unassignedDetail")}
              action={{ label: t("menus.add"), onClick: () => setAdding({ parent: null }) }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon="list"
              message={t("menus.empty")}
              action={{ label: t("menus.add"), onClick: () => setAdding({ parent: null }) }}
            />
          ) : (
            <Card footnote={t("menus.depthNote")}>
              <ul className="flex flex-col">
                {items.map((item, index) => (
                  <ItemRows
                    key={item.key}
                    item={item}
                    index={index}
                    siblings={items.length}
                    onMove={(from, to) => setItems((tree) => moveItem(tree, from, to))}
                    onMoveChild={(parentIndex, from, to) =>
                      updateAt([parentIndex], (parent) => ({
                        ...parent,
                        children: moveItem(parent.children, from, to),
                      }))
                    }
                    onEdit={(path, target) => setEditing({ path, item: target })}
                    onRemove={(path, label) => confirmRemove.ask({ path, label })}
                    onAddChild={(parentIndex) => setAdding({ parent: parentIndex })}
                    disabled={save.isPending}
                    atCap={atCap}
                  />
                ))}
              </ul>
            </Card>
          )}

          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            onSave={() => save.mutate()}
            onDiscard={() => {
              setItems(baseline);
              setFieldErrors({});
            }}
            blockedReason={online ? undefined : tStates("offlineWrites")}
          />
        </div>
      </PageBody>

      {editing || adding ? (
        <ItemModal
          /* Remount per target, so the fields seed once with the right values. */
          key={editing ? editing.path.join("-") : `new-${adding?.parent ?? "root"}`}
          item={
            editing?.item ?? {
              key: "",
              label: "",
              kind: "url",
              url: "",
              path: "",
              objectId: null,
              children: [],
            }
          }
          creating={editing === null}
          returnFocusTo={modalOpener}
          onClose={() => {
            setEditing(null);
            setAdding(null);
          }}
          onApply={(next) => {
            if (editing) {
              updateAt(editing.path, (item) => ({ ...item, ...next }));
              setEditing(null);
              return;
            }

            const created: Editable = { key: nextKey(), ...next, children: [] };
            const parent = adding?.parent ?? null;
            setItems((tree) =>
              parent === null
                ? [...tree, created]
                : tree.map((item, index) =>
                    index === parent
                      ? { ...item, children: [...item.children, created] }
                      : item,
                  ),
            );
            setAdding(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmRemove.open}
        onOpenChange={confirmRemove.onOpenChange}
        returnFocusTo={removeOpener}
        tone="destructive"
        title={t("menus.removeTitle")}
        /*
         * **No `requireTyped`.** §3.1 as amended: an item's identifier is its
         * label, which is free prose and, on an item read back from WordPress,
         * texturized — so it is not typeable from the screen. It is also the
         * softest of this branch's destructive acts: nothing is written until the
         * save bar is used and "Annuler les modifications" puts the subtree back.
         * The dialog names the label instead.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {confirmRemove.target?.label || t("menus.untitled")}
            </p>
            <p className="mt-1.5">{t("menus.removeBody")}</p>
          </>
        }
        confirmLabel={t("menus.remove")}
        onConfirm={() => {
          const target = confirmRemove.target;
          if (target) setItems((tree) => deleteAt(tree, target.path));
          confirmRemove.close();
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- the tree --- */

/** Keys are local identity, not content — excluded from the dirty comparison. */
function stripKeys(item: Editable): unknown {
  return {
    label: item.label,
    kind: item.kind,
    url: item.url,
    path: item.path,
    objectId: item.objectId,
    children: item.children.map(stripKeys),
  };
}

function applyAt(
  tree: Editable[],
  path: number[],
  updater: (item: Editable) => Editable,
): Editable[] {
  const [head, ...rest] = path;
  return tree.map((item, index) => {
    if (index !== head) return item;
    if (rest.length === 0) return updater(item);
    return { ...item, children: applyAt(item.children, rest, updater) };
  });
}

function deleteAt(tree: Editable[], path: number[]): Editable[] {
  const [head, ...rest] = path;
  if (rest.length === 0) return tree.filter((_, index) => index !== head);
  return tree.map((item, index) =>
    index === head ? { ...item, children: deleteAt(item.children, rest) } : item,
  );
}

/**
 * A top-level item and its children.
 *
 * Two levels and no recursion beyond them, which mirrors the API: a third level
 * is a 400 naming where. Rendering a tree that could go deeper than the writer
 * accepts would be offering a move that always fails.
 *
 * Each row carries one `Menu` rather than a row of icon buttons (§3.2) — the
 * old version had a separate "add child" and "remove" button beside the reorder
 * pair, which is four controls in a 340px row. The reorder pair stays visible
 * because it is the whole keyboard and touch path to ordering; see `Reorder`.
 */
function ItemRows({
  item,
  index,
  siblings,
  onMove,
  onMoveChild,
  onEdit,
  onRemove,
  onAddChild,
  disabled,
  atCap,
}: {
  item: Editable;
  index: number;
  siblings: number;
  onMove: (from: number, to: number) => void;
  onMoveChild: (parentIndex: number, from: number, to: number) => void;
  onEdit: (path: number[], item: Editable) => void;
  onRemove: (path: number[], label: string) => void;
  onAddChild: (parentIndex: number) => void;
  disabled: boolean;
  atCap: boolean;
}) {
  const t = useTranslations("content");

  return (
    <>
      <li className="ui-row flex min-w-0 items-center gap-3 py-2">
        <ItemLabel item={item} path={[index]} onEdit={() => onEdit([index], item)} />
        <Reorder
          index={index}
          count={siblings}
          onMove={onMove}
          label={item.label || t("menus.untitled")}
          disabled={disabled}
        />
        <Menu
          label={t("menus.rowActions", { label: item.label || t("menus.untitled") })}
          actions={[
            {
              key: "child",
              label: t("menus.addChild"),
              icon: "plus",
              disabled: disabled || atCap,
              onSelect: () => onAddChild(index),
            },
            {
              key: "remove",
              label: t("menus.remove"),
              icon: "trash",
              destructive: true,
              disabled,
              onSelect: () => onRemove([index], item.label),
            },
          ]}
          trigger={
            <IconButton
              id={itemMenuId([index])}
              label={t("menus.rowActions", { label: item.label || t("menus.untitled") })}
              icon="more"
              variant="ghost"
              size="sm"
              className="shrink-0"
            />
          }
        />
      </li>

      {item.children.map((child, childIndex) => (
        <li
          key={child.key}
          /* `ps-`, not `pl-`: the indent follows the reader. */
          className="ui-row flex min-w-0 items-center gap-3 py-2 ps-6"
        >
          <ItemLabel
            item={child}
            path={[index, childIndex]}
            onEdit={() => onEdit([index, childIndex], child)}
          />
          <Reorder
            index={childIndex}
            count={item.children.length}
            onMove={(from, to) => onMoveChild(index, from, to)}
            label={child.label || t("menus.untitled")}
            disabled={disabled}
          />
          <Menu
            label={t("menus.rowActions", { label: child.label || t("menus.untitled") })}
            actions={[
              {
                key: "remove",
                label: t("menus.remove"),
                icon: "trash",
                destructive: true,
                disabled,
                onSelect: () => onRemove([index, childIndex], child.label),
              },
            ]}
            trigger={
              <IconButton
                id={itemMenuId([index, childIndex])}
                label={t("menus.rowActions", { label: child.label || t("menus.untitled") })}
                icon="more"
                variant="ghost"
                size="sm"
                className="shrink-0"
              />
            }
          />
        </li>
      ))}
    </>
  );
}

function ItemLabel({
  item,
  path,
  onEdit,
}: {
  item: Editable;
  path: number[];
  onEdit: () => void;
}) {
  const t = useTranslations("content");

  return (
    <button
      id={itemOpenerId(path)}
      type="button"
      onClick={onEdit}
      className="ui-ring ui-interactive flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-ui-md text-start"
    >
      <span dir="auto" className="truncate text-ui-subheading text-ui-fg">
        {item.label || t("menus.untitled")}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-ui-label text-ui-muted">
        <span className="shrink-0">{t(`menus.type.${item.kind}`)}</span>
        {item.kind === "url" && item.url !== "" ? (
          <Ltr numeric={false} className="min-w-0 truncate">
            {item.url}
          </Ltr>
        ) : item.kind === "page" && item.path !== "" ? (
          <Ltr numeric={false} className="min-w-0 truncate">
            /{item.path}
          </Ltr>
        ) : item.objectId !== null ? (
          <Ltr numeric className="min-w-0 truncate">
            #{item.objectId}
          </Ltr>
        ) : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- the modal --- */

/**
 * One item's fields.
 *
 * A `Modal` and not a `Drawer`: §3.1 gives a Drawer to "context beside the page"
 * and a Modal to "a task that must be finished or abandoned". Nothing behind this
 * form is being read from while it is filled in — the tree it belongs to is the
 * thing being *changed*, not consulted — which is the same test that makes
 * `shipping/rules`' `RuleForm` a modal and `CreateParcelDrawer` a drawer. It
 * writes nothing: applying edits the local draft and the save bar is what sends
 * the document.
 */
function ItemModal({
  item,
  creating,
  returnFocusTo,
  onClose,
  onApply,
}: {
  item: Editable;
  creating: boolean;
  returnFocusTo?: string;
  onClose: () => void;
  onApply: (next: Omit<Editable, "key" | "children">) => void;
}) {
  const t = useTranslations("content");
  const tUi = useTranslations("ui");

  const [label, setLabel] = useState(item.label);
  const [kind, setKind] = useState<MenuItemType>(item.kind);
  const [url, setUrl] = useState(item.url);
  const [path, setPath] = useState(item.path);
  const [objectId, setObjectId] = useState(item.objectId === null ? "" : String(item.objectId));

  /*
   * **`javascript:` is a valid URL, and this is where that matters.** The API
   * refuses it on `items[0].url`; the panel refuses it here so the person is told
   * by the field rather than by a round trip that loses their place in a
   * fifty-item tree. `//host` is refused too — it is not a path, it is a
   * protocol-relative URL to somewhere else.
   *
   * Handed to `validate` rather than computed into `error`, so §3.4's timing
   * applies: silent until the first blur, live afterwards. Half a URL is not a
   * bad URL.
   */
  const urlRule = (value: string) =>
    value.trim() !== "" && !isAllowedMenuUrl(value) ? t("menus.urlInvalid") : undefined;

  const incomplete =
    label.trim() === "" ||
    (kind === "url" && (url.trim() === "" || urlRule(url) !== undefined)) ||
    (kind === "page" && path.trim() === "" && objectId.trim() === "") ||
    (kind !== "url" && kind !== "page" && objectId.trim() === "");

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
      returnFocusTo={returnFocusTo}
      title={creating ? t("menus.addTitle") : t("menus.editTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tUi("cancel")}
          </Button>
          <Button
            onClick={() =>
              onApply({
                label: label.trim(),
                kind,
                url: url.trim(),
                path: path.trim(),
                objectId: objectId.trim() === "" ? null : Number.parseInt(objectId, 10),
              })
            }
            disabled={incomplete}
            /* §3.3: a disabled control says why. */
            title={incomplete ? t("menus.applyBlocked") : undefined}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label={t("menus.field.label")} value={label} onChange={setLabel} />

        <Select<MenuItemType>
          label={t("menus.field.type")}
          value={kind}
          onChange={setKind}
          options={MENU_ITEM_TYPES.map((value) => ({
            value,
            label: t(`menus.type.${value}`),
          }))}
        />

        {kind === "url" ? (
          <TextField
            label={t("menus.field.url")}
            value={url}
            onChange={setUrl}
            validate={urlRule}
            isolate
            placeholder="/soldes"
            hint={t("menus.field.urlHint")}
          />
        ) : kind === "page" ? (
          <>
            <TextField
              label={t("menus.field.path")}
              value={path}
              onChange={setPath}
              isolate
              placeholder="legal/conditions-generales"
              hint={t("menus.field.pathHint")}
            />
            <TextField
              label={t("menus.field.objectId")}
              value={objectId}
              onChange={setObjectId}
              isolate
              inputMode="numeric"
              hint={t("menus.field.objectIdPageHint")}
            />
          </>
        ) : (
          <TextField
            label={t("menus.field.objectId")}
            value={objectId}
            onChange={setObjectId}
            isolate
            inputMode="numeric"
            hint={t("menus.field.objectIdHint")}
          />
        )}
      </div>
    </Modal>
  );
}
