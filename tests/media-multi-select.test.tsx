/**
 * Multi-select in the media picker — item 7 of the fix round.
 *
 * ## Why this one is a render and not a pure function
 *
 * `tests/new-product.test.ts` opens by arguing the opposite: the interesting
 * half of a create form is which keys reach the wire, and that is a pure
 * function of a plain object, so it is asserted without a render. Nothing here
 * is that shape. The four claims this change makes are all claims about a
 * *document*:
 *
 *   1. **a tile is a real checkbox**, which is a fact about the accessibility
 *      tree and not about any value — `<button role="checkbox">` would pass
 *      every assertion a shape test could make and still be the control
 *      `Form.tsx` and two screens in this panel record ripping out;
 *   2. **the three single-select callers are unchanged**, which is a fact about
 *      what the *other* branch renders — the union type stops them passing the
 *      new prop, and only a render says the tree they get is still buttons;
 *   3. **five picks are one write**, which is a claim about how many times a
 *      callback fired across five presses and a confirm, and no return value
 *      carries it;
 *   4. **a selection survives paging**, which is a claim about state across two
 *      fetches.
 *
 * §3 runs against the mock's own `respond()` with `fetch` pointed at it, which
 * is `tests/carrier-quotes.test.tsx`'s arrangement and its argument: the rows
 * these assertions read are the rows `scripts/mock-api.mjs` serves and
 * `tests/mock-api.test.ts` parses with the panel's own Zod schema, so there is
 * no second fixture here to drift from the first. 41 attachments at 20 a page
 * is three pages, which is what makes §3's paging test a real one rather than a
 * staged one.
 *
 * **The fixtures are not touched and must not be.** No seeded product has an
 * image — all 28 carry `image_id: 0` — and three media-usage assertions in
 * `tests/mock-api.test.ts` depend on those cold-start zeros. So §3 hands
 * `ProductMedia` its gallery as a *prop*, which is what the screen does anyway:
 * `ProductDetail` owns the draft and this component takes `galleryIds` and
 * `onGalleryChange` from it.
 *
 * ## Arabic is not a spot check here
 *
 * §4 exists because the count is the one string in this change that is a plural,
 * and Arabic has six categories where French has two. A count rendered through
 * `other` for two images reads "2 صورة" — grammatical nonsense — and no French
 * render can catch it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { MediaGrid, mediaTileId } from "@/components/ui/MediaGrid";
import { ProductMedia } from "@/app/[locale]/(panel)/products/[id]/ProductMedia";
import type { MediaItem } from "@/lib/api/schemas/media";
import { BASE_PATH, resetState, respond } from "@/scripts/mock-api.mjs";

/**
 * Only the fields a tile reads. `mediaItem` is a `looseObject` and the grid
 * touches four keys of it, so a fixture carrying the whole shape would be
 * fourteen lines of noise per row asserting nothing.
 */
const item = (id: number, title: string): MediaItem =>
  ({
    id,
    title,
    filename: `${title.toLowerCase().replaceAll(" ", "-")}.jpg`,
    url: `http://mock.invalid/${id}.jpg`,
    alt: "",
    caption: "",
    slug: `${id}`,
    mime_type: "image/jpeg",
    filesize: 1000,
    width: 30,
    height: 20,
    sizes: {},
    uploaded_by: 1,
    date_created: "2026-08-01T00:00:00",
    date_modified: "2026-08-01T00:00:00",
  }) as MediaItem;

const ROWS = [item(1, "Tapis"), item(2, "Kilim"), item(3, "Burnous")];

function withIntl(node: React.ReactNode, locale: "fr" | "ar" = "fr") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : fr}>
      {node}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

/* ─────────────────────────────────────── 1. the grid a caller does not opt in ─── */

describe("a grid with no selection is the grid that shipped", () => {
  it("draws a button per tile and not one checkbox", () => {
    render(
      withIntl(
        <MediaGrid
          items={ROWS}
          scope="media-pick"
          onOpen={() => {}}
          page={1}
          perPage={20}
          total={3}
          onPageChange={() => {}}
        />,
      ),
    );

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    /* The id is the contract with `returnFocusTo`, and it is the same helper
       the tables use — asserted on both branches, because moving it onto the
       input in §2 is the kind of change that compiles either way. */
    expect(screen.getByRole("button", { name: "Tapis" })).toHaveAttribute(
      "id",
      mediaTileId("media-pick", 1),
    );
  });

  it("hands the whole item to the caller, because the caller needs the URL", () => {
    const onOpen = vi.fn();
    render(
      withIntl(
        <MediaGrid
          items={ROWS}
          scope="media-pick"
          onOpen={onOpen}
          page={1}
          perPage={20}
          total={3}
          onPageChange={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Kilim" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(2);
  });
});

/* ──────────────────────────────────────────────── 2. the grid that selects ─── */

describe("a selecting grid", () => {
  const selecting = (
    selected: number[],
    held: number[],
    onToggle: (item: MediaItem, next: boolean) => void,
  ) =>
    withIntl(
      <MediaGrid
        items={ROWS}
        scope="media-pick"
        selection={{ selected, held, onToggle }}
        page={1}
        perPage={20}
        total={3}
        onPageChange={() => {}}
      />,
    );

  it("is real checkboxes, named by the tile's own label", () => {
    render(selecting([], [], () => {}));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    /* A `<button role="checkbox">` would satisfy the line above and fail this
       one: `getAllByRole` reads the tree, `tagName` reads what the browser will
       actually give space-to-toggle and form association to. */
    for (const box of boxes) expect(box.tagName).toBe("INPUT");
    expect(screen.getByRole("checkbox", { name: "Tapis" })).toHaveAttribute(
      "id",
      mediaTileId("media-pick", 1),
    );
  });

  it("reports the item and the direction, both ways", () => {
    const onToggle = vi.fn();
    const { rerender } = render(selecting([], [], onToggle));

    fireEvent.click(screen.getByRole("checkbox", { name: "Kilim" }));
    expect(onToggle.mock.calls[0][0].id).toBe(2);
    expect(onToggle.mock.calls[0][1]).toBe(true);

    rerender(selecting([2], [], onToggle));
    expect(screen.getByRole("checkbox", { name: "Kilim" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Kilim" }));
    expect(onToggle.mock.calls[1][1]).toBe(false);
  });

  it("draws a held tile ticked, disabled, and says which it is", () => {
    const onToggle = vi.fn();
    render(selecting([], [3], onToggle));

    /* The phrase is *in* the accessible name, not beside it: a tile named
       "Burnous" alone leaves a screen-reader user with a ticked box and no
       reason for it. The visible caption is still "Burnous", which is what
       WCAG 2.5.3 asks — the name contains the label. */
    const held = screen.getByRole("checkbox", { name: "Burnous — déjà ajoutée" });
    expect(held).toBeChecked();
    /*
     * `disabled` is the whole assertion, and there is deliberately no
     * "clicking it does nothing" beside it. HTML bars a disabled control from
     * dispatching a click **queued on the user interaction task source** — a
     * real press — and says nothing about a synthetic `dispatchEvent`, which
     * jsdom therefore runs the activation behaviour for. A test that pressed it
     * would be asserting a jsdom quirk in either direction rather than the
     * browser's behaviour, and it fails here against correct code.
     */
    expect(held).toBeDisabled();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────────── 3. the gallery, through the real picker ─── */

describe("the product's gallery picker", () => {
  beforeEach(() => {
    resetState();
    vi.stubGlobal("fetch", async (url: string) => {
      const parsed = new URL(url, "http://mock.invalid");
      const answer = respond(
        "GET",
        parsed.pathname.replace("/api/ac", BASE_PATH),
        parsed.searchParams,
        null,
      );
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  /**
   * The screen as `ProductDetail` mounts it, minus the draft: `galleryIds` is a
   * prop and `onGalleryChange` is the spy, which is exactly the boundary the
   * "one write" claim is about — everything below it is one PATCH by
   * construction, because `ProductDetail`'s draft is local until the save bar.
   */
  const mount = (
    galleryIds: number[],
    onGalleryChange: (next: number[]) => void,
    onImageIdChange: (next: string) => void = () => {},
    locale: "fr" | "ar" = "fr",
  ) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      withIntl(
        <QueryClientProvider client={client}>
          <ProductMedia
            canPickMedia
            storedImage={null}
            storedGallery={[]}
            imageId=""
            onImageIdChange={onImageIdChange}
            galleryIds={galleryIds}
            onGalleryChange={onGalleryChange}
            disabled={false}
            fieldId={(key) => `product-${key}`}
          />
        </QueryClientProvider>,
        locale,
      ),
    );
  };

  /** Open the gallery picker and wait for the library to land. */
  const openGallery = async (label = "Ajouter une image") => {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(20));
    return screen.getAllByRole("checkbox");
  };

  it("turns three ticks and a confirm into exactly one write", async () => {
    const onGalleryChange = vi.fn();
    mount([], onGalleryChange);

    const boxes = await openGallery();
    /* Page 1 is newest first — 5041, 5040, 5039 — and the ids are asserted
       rather than the order of the array under test being trusted to say so. */
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter 3 images" }));

    expect(onGalleryChange).toHaveBeenCalledTimes(1);
    expect(onGalleryChange).toHaveBeenCalledWith([5041, 5040, 5039]);
  });

  it("appends in the order they were ticked, because a gallery is a sequence", async () => {
    const onGalleryChange = vi.fn();
    mount([9001], onGalleryChange);

    const boxes = await openGallery();
    fireEvent.click(boxes[2]);
    fireEvent.click(boxes[0]);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter 2 images" }));
    /* The existing entry first and untouched: confirming only ever appends. */
    expect(onGalleryChange).toHaveBeenCalledWith([9001, 5039, 5041]);
  });

  it("keeps the selection across a page change", async () => {
    const onGalleryChange = vi.fn();
    mount([], onGalleryChange);

    const first = await openGallery();
    fireEvent.click(first[0]);
    expect(screen.getByRole("status")).toHaveTextContent("1 image sélectionnée");

    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    /* Page 2 opens at 5021 — a different set of tiles, none of them the one
       that is ticked, which is the whole point of the assertion below. Waited on
       by id rather than by name: every title in the library begins "Photo — ",
       so a name query matches twenty rows on either page and would pass before
       the second fetch landed. */
    await waitFor(() =>
      expect(document.getElementById(mediaTileId("media-pick", 5021))).not.toBeNull(),
    );
    expect(document.getElementById(mediaTileId("media-pick", 5041))).toBeNull();

    fireEvent.click(document.getElementById(mediaTileId("media-pick", 5021))!);
    expect(screen.getByRole("status")).toHaveTextContent("2 images sélectionnées");

    fireEvent.click(screen.getByRole("button", { name: "Ajouter 2 images" }));
    expect(onGalleryChange).toHaveBeenCalledTimes(1);
    expect(onGalleryChange).toHaveBeenCalledWith([5041, 5021]);
  });

  it("counts on the footer as well as in the bar, and clears from the bar", async () => {
    mount([], () => {});

    const boxes = await openGallery();
    /* Zero is the disabled commit, not an absent one — the footer's two other
       buttons would move if it came and went. */
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(screen.getByRole("button", { name: "Ajouter 2 images" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Désélectionner" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeDisabled();
  });

  it("hands the picker the gallery it is adding to, so nothing can be added twice", async () => {
    mount([5041], () => {});

    await openGallery();
    const held = screen.getByRole("checkbox", { name: /déjà ajoutée$/ });
    expect(held).toHaveAttribute("id", mediaTileId("media-pick", 5041));
    expect(held).toBeChecked();
    expect(held).toBeDisabled();

    /* `galleryDuplicate` is the message this path used to be able to earn. There
       is no press left that produces it. */
    expect(screen.queryByText("Cette image est déjà dans la galerie.")).toBeNull();
  });

  it("leaves the featured image single-select, closing on the pick", async () => {
    const onImageIdChange = vi.fn();
    mount([], () => {}, onImageIdChange);

    fireEvent.click(screen.getByRole("button", { name: "Choisir" }));
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(20));

    /* No checkbox in the image picker at all — the two contracts are chosen by
       `target`, and a grid that could multi-select `image_id` would be a control
       lying about a field that holds one attachment. */
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Ajouter/ })).toBeNull();

    fireEvent.click(document.getElementById(mediaTileId("media-pick", 5041))!);
    expect(onImageIdChange).toHaveBeenCalledWith("5041");
    await waitFor(() => expect(screen.queryAllByRole("checkbox")).toHaveLength(0));
  });
});

/* ─────────────────────────────────────────────────────────────── 4. Arabic ─── */

describe("Arabic, where a plural has six categories and French has two", () => {
  beforeEach(() => {
    resetState();
    vi.stubGlobal("fetch", async (url: string) => {
      const parsed = new URL(url, "http://mock.invalid");
      const answer = respond(
        "GET",
        parsed.pathname.replace("/api/ac", BASE_PATH),
        parsed.searchParams,
        null,
      );
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("counts two as a dual and three as a few, in the bar and on the commit", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      withIntl(
        <QueryClientProvider client={client}>
          <ProductMedia
            canPickMedia
            storedImage={null}
            storedGallery={[]}
            imageId=""
            onImageIdChange={() => {}}
            galleryIds={[]}
            onGalleryChange={() => {}}
            disabled={false}
            fieldId={(key) => `product-${key}`}
          />
        </QueryClientProvider>,
        "ar",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: ar.products.detail.galleryAdd }));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(20));
    const boxes = screen.getAllByRole("checkbox");

    fireEvent.click(boxes[0]);
    /* `one`, and it is not `# صورة`: the singular is a word, not a numeral. */
    expect(screen.getByRole("status")).toHaveTextContent("صورة واحدة محددة");

    fireEvent.click(boxes[1]);
    expect(screen.getByRole("status")).toHaveTextContent("صورتان محددتان");
    expect(screen.getByRole("button", { name: "إضافة صورتين" })).toBeEnabled();

    fireEvent.click(boxes[2]);
    expect(screen.getByRole("status")).toHaveTextContent("3 صور محددة");
    expect(screen.getByRole("button", { name: "إضافة 3 صور" })).toBeEnabled();
  });

  it("is in exact sync with French, and no leaf is empty", () => {
    const flat = (node: unknown, prefix = ""): string[] =>
      node === null || typeof node !== "object"
        ? [prefix]
        : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
            flat(value, prefix === "" ? key : `${prefix}.${key}`),
          );

    expect(flat(fr.media).sort()).toEqual(flat(ar.media).sort());
    expect(flat(fr.products.detail).sort()).toEqual(flat(ar.products.detail).sort());

    /* The three strings this branch minted, by name — a parity check passes
       just as happily on two files that are both missing a key. */
    for (const messages of [fr, ar]) {
      expect(messages.media.selectedCount).toContain("plural");
      /* `{name}` and not `{{name}}`: the doubled form parses as a literal brace
         plus a placeholder plus a literal brace, and `next-intl` throws
         `INVALID_MESSAGE` and renders the key path as visible text. Presence is
         not validity — `tests/new-product.test.ts` records the same trap. */
      expect(messages.media.alreadyAdded).toContain("{name}");
      expect(messages.media.alreadyAdded).not.toContain("{{name}}");
      expect(messages.products.detail.galleryAddSelected).toContain("=0");
    }
  });
});
