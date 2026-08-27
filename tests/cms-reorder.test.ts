import { describe, expect, it } from "vitest";
import { CMS_LIST_PER_PAGE, positionWrites, reorderBlock } from "@/lib/cms";

/**
 * The completeness guard on the banner and FAQ reorder controls.
 *
 * `tests/cms.test.ts` covers `positionWrites()` — *which* rows a move writes.
 * This file covers the question that has to be answered before that function is
 * allowed to run at all: **is the array in hand the whole collection?**
 *
 * `positionWrites()` renumbers what it is given to `0..n-1`. That is right when
 * the array is the collection and it is corruption when it is not, and there are
 * two ways to be handed a partial one: the fetch was truncated at `per_page`, or
 * a status filter removed the other status's rows from the middle of the
 * sequence. The last two tests reproduce each corruption rather than asserting
 * that it would happen.
 */
describe("whether a reorder control may be rendered", () => {
  const complete = { status: "any" as const, fetched: 4, total: 4 };

  it("renders on the unfiltered tab when the fetch reached the end", () => {
    expect(reorderBlock(complete)).toBeNull();
    expect(
      reorderBlock({
        status: "any",
        fetched: CMS_LIST_PER_PAGE,
        total: CMS_LIST_PER_PAGE,
      }),
    ).toBeNull();
  });

  it("refuses the moment one row was left behind", () => {
    // The exact edge both screens sat on: a hundred fetched, a hundred and one
    // stored.
    expect(
      reorderBlock({
        status: "any",
        fetched: CMS_LIST_PER_PAGE,
        total: CMS_LIST_PER_PAGE + 1,
      }),
    ).toBe("truncated");
    expect(reorderBlock({ status: "any", fetched: 100, total: 250 })).toBe("truncated");
  });

  it("refuses on a filtered tab, where the sequence has holes in it", () => {
    expect(reorderBlock({ ...complete, status: "publish" })).toBe("filtered");
    expect(reorderBlock({ ...complete, status: "draft" })).toBe("filtered");
  });

  it("reports truncation first, because clearing the filter would not help", () => {
    /*
     * Both true at once. Naming the filter here would send somebody to the `any`
     * tab to find the control still missing — a loop, and the sort of small
     * dishonesty that costs more trust than the missing control does.
     */
    expect(reorderBlock({ status: "draft", fetched: 100, total: 140 })).toBe("truncated");
  });

  it("keeps the control when `meta` carried no count", () => {
    /*
     * `acRead` defaults `total` to 0 when the envelope has no `meta.total`, and
     * that absence must not read as "every row is missing" — it would disable
     * reordering on a healthy list. The refusal fires on positive evidence only.
     */
    expect(reorderBlock({ status: "any", fetched: 4, total: 0 })).toBeNull();
  });

  it("allows an empty collection, which has nothing to corrupt", () => {
    expect(reorderBlock({ status: "any", fetched: 0, total: 0 })).toBeNull();
  });

  it("is what stops a truncated list renumbering rows nobody fetched", () => {
    /*
     * Three rows stand in for a hundred. The collection is five rows at dense
     * positions 0–4, the fetch returned the first three, and somebody moves the
     * third to the front.
     *
     * `positionWrites` is right about the array it was given and wrong about the
     * collection: it writes 1 and 2, which rows 4 and 5 already hold and keep.
     * Nothing errors — the order simply stops being a function of anything.
     */
    const fetched = [
      { id: 1, position: 0 },
      { id: 2, position: 1 },
      { id: 3, position: 2 },
    ];

    expect(positionWrites(fetched, [fetched[2], fetched[0], fetched[1]])).toEqual([
      { id: 3, position: 0 },
      { id: 1, position: 1 },
      { id: 2, position: 2 },
    ]);

    expect(reorderBlock({ status: "any", fetched: fetched.length, total: 5 })).toBe(
      "truncated",
    );
  });

  it("is what stops a filtered list writing over the rows it cannot see", () => {
    /*
     * The half a `meta.total` check alone would miss, and the reason the filter
     * is a block rather than a caveat. `?status=publish` returns the collection's
     * *stored* positions with the drafts missing from the middle — 0, 2, 3 where
     * a draft holds 1 — so `positionWrites` reports two writes against a list
     * **nobody moved a row in**, and both land on the draft's slot.
     */
    const published = [
      { id: 1, position: 0 },
      { id: 3, position: 2 },
      { id: 4, position: 3 },
    ];

    expect(positionWrites(published, [...published])).toEqual([
      { id: 3, position: 1 },
      { id: 4, position: 2 },
    ]);

    expect(
      reorderBlock({ status: "publish", fetched: published.length, total: published.length }),
    ).toBe("filtered");
  });
});
