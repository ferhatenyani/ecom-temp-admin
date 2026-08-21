"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { Menu, MenuItem, MenuWriteItem } from "@/lib/api/schemas/cms";
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
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { MoveControls, moveItem } from "@/components/patterns/MoveControls";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Sheet } from "@/components/primitives/Sheet";
import { SelectField, TextField } from "@/components/primitives/Field";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
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
 * dead end.
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

/**
 * Fetches the menu and hands it to the editor already loaded.
 *
 * The split is not decoration. The draft below is seeded with `useState`, and a
 * draft seeded from data that arrives *later* is the case an effect would have
 * to patch up — which is both a cascading render and, worse, wrong: switching
 * location while a tree is half-edited would leave one location's edits sitting
 * over another location's menu.
 *
 * `key={location}` makes React do it instead. A new location is a new component
 * with its own state, so the draft cannot outlive the menu it belongs to, and
 * nothing has to remember to clear it.
 */
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

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["cms", "menu", location],
    queryFn: async () => {
      try {
        const { data: menu } = await acRead<Menu>(`/cms/menus/${location}`);
        return menu;
      } catch (caught) {
        // The 404 is a *state*, not a failure: no menu is assigned here yet, and
        // a PUT will create one. Anything else is a real error.
        if (caught instanceof BrowserApiError && caught.status === 404) return null;
        throw caught;
      }
    },
  });

  const locationBar = (
    <Segmented<MenuLocation>
      segments={MENU_LOCATIONS.map((value) => ({
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
      <Scaffold
        title={t("section.menus")}
        back={{ href: `/${locale}/content`, label: t("title") }}
        toolbar={locationBar}
      >
        <div className="mx-auto max-w-3xl px-4">
          {isError ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : (
            <div
              role="status"
              aria-busy="true"
              aria-label={t("loading")}
              className="flex flex-col gap-2"
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton h-14 rounded-lg" />
              ))}
            </div>
          )}
        </div>
      </Scaffold>
    );
  }

  return (
    <MenuDraft
      key={location}
      locale={locale}
      location={location}
      menu={data ?? null}
      locationBar={locationBar}
      onReload={() => void refetch()}
    />
  );
}

function MenuDraft({
  locale,
  location,
  menu,
  locationBar,
  onReload,
}: {
  locale: string;
  location: MenuLocation;
  /** Null when no menu is assigned to this location — a state, not a failure. */
  menu: Menu | null;
  locationBar: ReactNode;
  onReload: () => void;
}) {
  const t = useTranslations("content");
  const toast = useToast();

  const [items, setItems] = useState<Editable[]>(() =>
    (menu?.items ?? []).map(editableOf),
  );
  const [baseline, setBaseline] = useState<string>(() =>
    JSON.stringify((menu?.items ?? []).map(editableOf).map(stripKeys)),
  );
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ path: number[]; item: Editable } | null>(null);
  const [adding, setAdding] = useState<{ parent: number | null } | null>(null);
  const [removing, setRemoving] = useState<number[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const current = items;
  const dirty = JSON.stringify(current.map(stripKeys)) !== baseline;
  const total = countItems(current);

  async function save() {
    setSaving(true);
    setFieldErrors({});

    try {
      const menu = await acWrite<Menu>("PUT", `/cms/menus/${location}`, {
        items: current.map(writeItem),
      });

      const fresh = menu.items.map(editableOf);
      setItems(fresh);
      setBaseline(JSON.stringify(fresh.map(stripKeys)));
      toast.show(t("menus.saved"));
    } catch (caught) {
      if (caught instanceof BrowserApiError) {
        /*
         * Errors are positional through the tree: `items[0].url`,
         * `items[1].children[0].object_id`. They are surfaced whole rather than
         * bound to a control, because the control they belong to may be two
         * levels down inside a sheet that is not open.
         */
        setFieldErrors(caught.fields ?? {});
        toast.show(caught.message, "danger");
      } else {
        throw caught;
      }
    } finally {
      setSaving(false);
    }
  }

  const updateAt = (path: number[], updater: (item: Editable) => Editable) =>
    setItems((tree) => applyAt(tree, path, updater));

  const removeAt = (path: number[]) => setItems((tree) => deleteAt(tree, path));

  return (
    <Scaffold
      title={t("section.menus")}
      back={{ href: `/${locale}/content`, label: t("title") }}
      trailing={
        <button
          type="button"
          onClick={() => setAdding({ parent: null })}
          disabled={total >= MAX_MENU_ITEMS}
          aria-label={t("menus.add")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent disabled:opacity-40"
        >
          <Icon name="plus" className="size-5" />
        </button>
      }
      toolbar={locationBar}
    >
      <div className="mx-auto max-w-3xl px-4">
        <p aria-live="polite" className="mb-2 px-1 text-footnote text-label-secondary" data-testid="menu-count">
          <Isolate numeric>{t("menus.count", { total, max: MAX_MENU_ITEMS })}</Isolate>
        </p>

        {Object.keys(fieldErrors).length > 0 ? (
          <div className="tone-danger tonal mb-3 flex flex-col gap-1 rounded-lg px-3 py-2">
            {Object.entries(fieldErrors).map(([field, message]) => (
              <span key={field} className="flex items-start gap-2 text-footnote">
                <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <Ltr numeric={false}>{field}</Ltr> — {message}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {menu === null && current.length === 0 ? (
          /*
            No menu is assigned here. Distinct from "the menu is empty" and from
            "that location does not exist", and the action works: a PUT creates
            and assigns one.
          */
          <EmptyState
            message={t("menus.unassigned")}
            action={{ label: t("menus.add"), onClick: () => setAdding({ parent: null }) }}
          />
        ) : current.length === 0 ? (
          <EmptyState
            message={t("menus.empty")}
            action={{ label: t("menus.add"), onClick: () => setAdding({ parent: null }) }}
          />
        ) : (
          <ListGroup footnote={t("menus.depthNote")}>
            {current.map((item, index) => (
              <ItemRows
                key={item.key}
                item={item}
                index={index}
                siblings={current.length}
                path={[index]}
                onMove={(from, to) => setItems((tree) => moveItem(tree, from, to))}
                onMoveChild={(parentIndex, from, to) =>
                  updateAt([parentIndex], (parent) => ({
                    ...parent,
                    children: moveItem(parent.children, from, to),
                  }))
                }
                onEdit={(path, target) => setEditing({ path, item: target })}
                onRemove={(path) => setRemoving(path)}
                onAddChild={(parentIndex) => setAdding({ parent: parentIndex })}
                disabled={saving}
                atCap={total >= MAX_MENU_ITEMS}
              />
            ))}
          </ListGroup>
        )}
      </div>

      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={onReload}
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

      {editing ? (
        <ItemSheet
          item={editing.item}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={(next) => {
            updateAt(editing.path, (item) => ({ ...item, ...next }));
            setEditing(null);
          }}
        />
      ) : null}

      {adding ? (
        <ItemSheet
          item={{ key: "", label: "", kind: "url", url: "", path: "", objectId: null, children: [] }}
          onOpenChange={(open) => !open && setAdding(null)}
          onSave={(next) => {
            const created: Editable = {
              key: nextKey(),
              label: next.label,
              kind: next.kind,
              url: next.url,
              path: next.path,
              objectId: next.objectId,
              children: [],
            };

            setItems((tree) => {
              if (adding.parent === null) return [...tree, created];
              return tree.map((item, index) =>
                index === adding.parent
                  ? { ...item, children: [...item.children, created] }
                  : item,
              );
            });
            setAdding(null);
          }}
        />
      ) : null}

      <ActionSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("menus.removeTitle")}
        description={t("menus.removeBody")}
        actions={[
          {
            label: t("menus.remove"),
            tone: "destructive",
            onSelect: () => {
              if (removing) removeAt(removing);
              setRemoving(null);
            },
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </Scaffold>
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

function applyAt(tree: Editable[], path: number[], updater: (item: Editable) => Editable): Editable[] {
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
 */
function ItemRows({
  item,
  index,
  siblings,
  path,
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
  path: number[];
  onMove: (from: number, to: number) => void;
  onMoveChild: (parentIndex: number, from: number, to: number) => void;
  onEdit: (path: number[], item: Editable) => void;
  onRemove: (path: number[]) => void;
  onAddChild: (parentIndex: number) => void;
  disabled: boolean;
  atCap: boolean;
}) {
  const t = useTranslations("content");

  return (
    <>
      <ListRow>
        <ItemLabel item={item} onEdit={() => onEdit(path, item)} />
        <MoveControls
          index={index}
          count={siblings}
          onMove={onMove}
          label={item.label}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => onAddChild(index)}
          disabled={disabled || atCap}
          aria-label={t("menus.addChild", { label: item.label })}
          className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
        >
          <Icon name="plus" className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(path)}
          disabled={disabled}
          aria-label={t("menus.removeItem", { label: item.label })}
          className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
        >
          <Icon name="trash" className="size-5" />
        </button>
      </ListRow>

      {item.children.map((child, childIndex) => (
        <ListRow key={child.key} className="ps-10">
          <ItemLabel item={child} onEdit={() => onEdit([index, childIndex], child)} />
          <MoveControls
            index={childIndex}
            count={item.children.length}
            onMove={(from, to) => onMoveChild(index, from, to)}
            label={child.label}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => onRemove([index, childIndex])}
            disabled={disabled}
            aria-label={t("menus.removeItem", { label: child.label })}
            className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
          >
            <Icon name="trash" className="size-5" />
          </button>
        </ListRow>
      ))}
    </>
  );
}

function ItemLabel({ item, onEdit }: { item: Editable; onEdit: () => void }) {
  const t = useTranslations("content");

  return (
    <button type="button" onClick={onEdit} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-start">
      <span className="truncate text-body text-label" dir="auto">
        {item.label || t("menus.untitled")}
      </span>
      <span className="flex items-center gap-1.5 text-footnote text-label-secondary">
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

/* -------------------------------------------------------------- the sheet --- */

function ItemSheet({
  item,
  onOpenChange,
  onSave,
}: {
  item: Editable;
  onOpenChange: (open: boolean) => void;
  onSave: (next: Omit<Editable, "key" | "children">) => void;
}) {
  const t = useTranslations("content");

  const [label, setLabel] = useState(item.label);
  const [kind, setKind] = useState<MenuItemType>(item.kind);
  const [url, setUrl] = useState(item.url);
  const [path, setPath] = useState(item.path);
  const [objectId, setObjectId] = useState(item.objectId === null ? "" : String(item.objectId));

  /*
   * **`javascript:` is a valid URL, and this is where that matters.** The API
   * refuses it on `items[0].url`; the panel refuses it here so the person is
   * told by the field rather than by a round trip that loses their place in a
   * fifty-item tree. `//host` is refused too — it is not a path, it is a
   * protocol-relative URL to somewhere else.
   */
  const urlError =
    kind === "url" && url.trim() !== "" && !isAllowedMenuUrl(url)
      ? t("menus.urlInvalid")
      : undefined;

  const incomplete =
    label.trim() === "" ||
    (kind === "url" && (url.trim() === "" || urlError !== undefined)) ||
    (kind === "page" && path.trim() === "" && objectId.trim() === "") ||
    (kind !== "url" && kind !== "page" && objectId.trim() === "");

  return (
    <ActionSheetShell
      title={item.key === "" ? t("menus.addTitle") : t("menus.editTitle")}
      onOpenChange={onOpenChange}
      onSave={() =>
        onSave({
          label: label.trim(),
          kind,
          url: url.trim(),
          path: path.trim(),
          objectId: objectId.trim() === "" ? null : Number.parseInt(objectId, 10),
        })
      }
      disabled={incomplete}
    >
      <ListGroup>
        <TextField label={t("menus.field.label")} value={label} onChange={setLabel} />
        <SelectField<MenuItemType>
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
            error={urlError}
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
      </ListGroup>
    </ActionSheetShell>
  );
}

/** The item sheet's chrome, kept apart so the form above reads as a form. */
function ActionSheetShell({
  title,
  onOpenChange,
  onSave,
  disabled,
  children,
}: {
  title: string;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("content");

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="flex items-center gap-3">
          <Button variant="plain" onClick={() => onOpenChange(false)} className="flex-1">
            {t("cancel")}
          </Button>
          <Button variant="filled" onClick={onSave} disabled={disabled} className="flex-1">
            {t("apply")}
          </Button>
        </div>
      }
    >
      {children}
    </Sheet>
  );
}
