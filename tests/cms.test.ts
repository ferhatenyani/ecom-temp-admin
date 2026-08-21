import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_FILTER,
  MAX_SECTIONS,
  SECTION_TYPES,
  classifyProblem,
  collidingPaths,
  isAllowedMenuUrl,
  isSectionType,
  pageDepth,
  parentPathOf,
  positionWrites,
  unknownSectionTypes,
} from "@/lib/cms";
import { moveItem } from "@/components/patterns/MoveControls";

describe("colliding page paths", () => {
  /*
   * The measured defect, and the reason the Pages index refuses to link a row.
   *
   * `wp_unique_post_slug()` does not run for a draft, so nothing stops two pages
   * sharing a path — and a path is the only address `/cms/pages/{path}` has.
   * Measured before the seed cleaned this shop: 53 rows answered to
   * `ac-unpublished` and 27 to `conditions`, and `get_page_by_path()` resolves
   * exactly one of each. The other 78 could not be read, written or deleted at
   * all.
   */
  it("finds the paths carried by more than one row", () => {
    const found = collidingPaths([
      "conditions",
      "livraison",
      "conditions",
      "legal",
      "legal/conditions-generales",
    ]);

    expect([...found]).toEqual(["conditions"]);
  });

  it("is empty when every path is unique — the state the seed leaves behind", () => {
    expect(
      collidingPaths(["livraison", "legal", "legal/conditions-generales", "retours"]).size,
    ).toBe(0);
  });

  it("does not confuse a child path with its parent", () => {
    // `legal` and `legal/terms` are two different pages, not a collision — the
    // naive check (compare the first segment) would have said otherwise.
    expect(collidingPaths(["legal", "legal/terms", "legal/privacy"]).size).toBe(0);
  });
});

describe("the homepage drop report", () => {
  /*
   * `meta.problems` is English prose with a number in it, not an object keyed by
   * anything — so there is nothing to hang a translation on, and rendering it
   * raw is what put an English paragraph across the middle of an Arabic sheet on
   * the analytics branch. These four sentences are the live API's, verbatim.
   */
  it("classifies each shape the reader can report", () => {
    expect(classifyProblem("Section 2 is not an object.")).toEqual({
      position: 2,
      kind: "not_an_object",
      detail: "Section 2 is not an object.",
    });

    expect(classifyProblem('Section 4 has an unknown type "carousel".').kind).toBe(
      "unknown_type",
    );
    expect(classifyProblem('Section 4 has an unknown type "carousel".').position).toBe(4);

    expect(
      classifyProblem('Section 6 ("promotion") has a "data" that is not an object.').kind,
    ).toBe("bad_data");

    expect(classifyProblem("More than 50 sections; the rest were dropped.")).toEqual({
      position: null,
      kind: "too_many",
      detail: "More than 50 sections; the rest were dropped.",
    });
  });

  it("keeps the API's sentence whole, whatever it is", () => {
    // A shape this build has no name for still carries its text, because the
    // text is the actionable half and the panel's line is only the frame.
    const problem = classifyProblem("Something nobody has seen yet.");
    expect(problem.kind).toBe("other");
    expect(problem.detail).toBe("Something nobody has seen yet.");
  });

  it("reports the position over the stored document, not the surviving list", () => {
    /*
     * The seed interleaves its malformed sections precisely so this cannot drift:
     * with bad sections at stored positions 2, 4 and 6, five survive, and
     * "Section 6" is not the sixth row on screen. A report that renumbered
     * against the surviving list would send somebody to the wrong row.
     */
    const positions = [
      "Section 2 is not an object.",
      'Section 4 has an unknown type "carousel".',
      'Section 6 ("promotion") has a "data" that is not an object.',
    ].map((sentence) => classifyProblem(sentence).position);

    expect(positions).toEqual([2, 4, 6]);
  });
});

describe("the section vocabulary", () => {
  it("is the eleven the API's 400 enumerates", () => {
    // Read out of `PUT /cms/homepage` with an unknown type, because no endpoint
    // publishes it. If the backend gains a twelfth, this is where it is noticed.
    expect(SECTION_TYPES).toHaveLength(11);
    expect(isSectionType("hero")).toBe(true);
    expect(isSectionType("carousel")).toBe(false);
  });

  it("names the types a document carries that this build does not know", () => {
    expect(unknownSectionTypes(["hero", "carousel", "text", "carousel"])).toEqual([
      "carousel",
    ]);
    expect(unknownSectionTypes(["hero", "text"])).toEqual([]);
  });

  it("caps at fifty, which the API reports on `sections` and not positionally", () => {
    expect(MAX_SECTIONS).toBe(50);
  });
});

describe("menu URLs", () => {
  /*
   * **`javascript:` is a valid URL** and this is where that matters. The API
   * refuses it on `items[0].url`; the panel refuses it before sending, so the
   * person is told by the field rather than by a round trip that loses their
   * place in a fifty-item tree.
   */
  it("refuses a javascript: URL", () => {
    expect(isAllowedMenuUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedMenuUrl("JavaScript:alert(1)")).toBe(false);
    expect(isAllowedMenuUrl("data:text/html,<script>")).toBe(false);
  });

  it("refuses a protocol-relative URL, which is not a path", () => {
    // `//evil.test` looks like a path and is a different origin.
    expect(isAllowedMenuUrl("//evil.test/x")).toBe(false);
  });

  it("accepts http, https and a root-relative path", () => {
    expect(isAllowedMenuUrl("https://example.test/soldes")).toBe(true);
    expect(isAllowedMenuUrl("http://example.test")).toBe(true);
    // A storefront's own routes carry no scheme; `MenuInput` accepts these.
    expect(isAllowedMenuUrl("/soldes")).toBe(true);
    expect(isAllowedMenuUrl("/legal/conditions-generales")).toBe(true);
  });

  it("refuses an empty or relative URL", () => {
    expect(isAllowedMenuUrl("")).toBe(false);
    expect(isAllowedMenuUrl("   ")).toBe(false);
    expect(isAllowedMenuUrl("soldes")).toBe(false);
  });
});

describe("page paths", () => {
  it("splits a parent from a path", () => {
    expect(parentPathOf("legal/conditions-generales")).toBe("legal");
    expect(parentPathOf("livraison")).toBe("");
    expect(parentPathOf("a/b/c")).toBe("a/b");
  });

  it("measures depth from the path, root being zero", () => {
    expect(pageDepth("livraison")).toBe(0);
    expect(pageDepth("legal/conditions-generales")).toBe(1);
    expect(pageDepth("a/b/c")).toBe(2);
  });
});

describe("the status filter default", () => {
  /*
   * The inversion worth asserting: every other list in this panel opens with no
   * `?status=` and gets everything. These routes default to **publish**, so a
   * screen that sent nothing would hide every draft — and a draft is the single
   * most likely reason somebody opened a content screen.
   */
  it("is `any`, not the API's default", () => {
    expect(DEFAULT_STATUS_FILTER).toBe("any");
  });
});

describe("which rows a reorder actually writes", () => {
  const rows = (...positions: number[]) =>
    positions.map((position, index) => ({ id: index + 1, position }));

  it("writes only the rows whose slot changed", () => {
    // 1,2,3 → 3,1,2. Every row moved, so every row is written.
    const before = rows(0, 1, 2);
    const after = [before[2], before[0], before[1]];

    expect(positionWrites(before, after)).toEqual([
      { id: 3, position: 0 },
      { id: 1, position: 1 },
      { id: 2, position: 2 },
    ]);
  });

  it("leaves the rows a swap did not touch alone", () => {
    /*
     * Four rows, the first two swapped. Two writes, not four — a burst of
     * writes that say nothing still counts against the 120-a-minute cap.
     */
    const before = rows(0, 1, 2, 3);
    const after = [before[1], before[0], before[2], before[3]];

    expect(positionWrites(before, after)).toEqual([
      { id: 2, position: 0 },
      { id: 1, position: 1 },
    ]);
  });

  it("writes nothing when nothing moved", () => {
    const before = rows(0, 1, 2);
    expect(positionWrites(before, [...before])).toEqual([]);
  });

  it("repairs positions that had drifted, even where nothing moved", () => {
    /*
     * The half the first version got wrong. Checking only "is this row still in
     * the same slot" leaves a collection whose stored positions are not
     * `0..n-1` drifted forever, because every row looks unmoved. Dense
     * positions make the two checks agree today; this is what keeps them
     * agreeing if a row is ever created or deleted out of band.
     */
    const before = rows(0, 5, 9);
    expect(positionWrites(before, [...before])).toEqual([
      { id: 2, position: 1 },
      { id: 3, position: 2 },
    ]);
  });
});

describe("reordering", () => {
  it("moves an item and leaves the rest in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 2, 0)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("is a no-op for a target the buttons cannot produce", () => {
    // The controls disable at the ends, so these cannot happen from the UI —
    // asserted so a keyboard shortcut added later does not have to re-check.
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("never mutates the array it was given", () => {
    const original = ["a", "b", "c"];
    moveItem(original, 0, 2);
    expect(original).toEqual(["a", "b", "c"]);
  });
});
