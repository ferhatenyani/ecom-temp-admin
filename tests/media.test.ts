import { describe, expect, it } from "vitest";
import {
  ACCEPTED_EXTENSIONS,
  MAX_BYTES,
  MIN_BYTES,
  classifyRefusal,
  formatBytes,
  precheck,
} from "@/lib/media";
import {
  MEDIA_ORDERS,
  listParams,
  queryFromParams,
  toUrlParams,
  type MediaOrder,
} from "@/app/[locale]/(panel)/media/query";

/**
 * The upload taxonomy, and the correction that produced it.
 *
 * ADMIN_PANEL.md says "**413** for size and **415** for type, and both need
 * distinct messages". Measured 2026-08-21 there are five distinguishable
 * failures — and the first attempt at measuring got one of them wrong, which is
 * why these tests exist in this shape.
 *
 * A PDF renamed `.png` answered **400 "The uploaded file is empty or
 * truncated."**, which reads like a third code for a disguised file. It is not:
 * the fake PDF was 48 bytes and `UploadPolicy` checks `MIN_BYTES = 64` *before*
 * it sniffs anything, so the size floor fired and the sniffer never ran. With a
 * 5.4 KB control the same file answers 415 with `details.detected`.
 */

describe("what the browser can refuse before spending the upload", () => {
  const file = (name: string, size: number) => ({ name, size });

  it("passes a plausible image", () => {
    expect(precheck(file("tapis.jpg", 400_000))).toBeNull();
    expect(precheck(file("TAPIS.JPEG", 400_000))).toBeNull();
    expect(precheck(file("kilim.webp", 90_000))).toBeNull();
  });

  it("refuses an extension the API does not accept", () => {
    expect(precheck(file("photo.gif", 400_000))).toEqual({
      kind: "bad_extension",
      extension: "gif",
    });
    // `.svg` is on the API's forbidden-segment list for a reason: it is markup.
    expect(precheck(file("logo.svg", 400_000))?.kind).toBe("bad_extension");
  });

  it("refuses a file with no extension at all", () => {
    expect(precheck(file("scan", 400_000))).toEqual({ kind: "bad_filename" });
  });

  it("refuses below the API's 64-byte floor and above its 8 MiB cap", () => {
    expect(precheck(file("empty.png", 0))).toEqual({ kind: "too_small", size: 0 });
    expect(precheck(file("tiny.png", MIN_BYTES - 1))?.kind).toBe("too_small");
    expect(precheck(file("huge.jpg", MAX_BYTES + 1))?.kind).toBe("too_large");
    // Exactly at the cap is fine — the API's check is `>`, not `>=`.
    expect(precheck(file("edge.jpg", MAX_BYTES))).toBeNull();
  });

  it("does not sniff, because a browser cannot", () => {
    /*
     * `File.type` is the operating system's guess from the extension, so
     * checking it would refuse nothing the extension check does not already
     * refuse — and would wrongly refuse a correctly-named file whose type the OS
     * has no mapping for. A JPEG renamed `.png` therefore passes here and is
     * caught by the server, which is the honest split.
     */
    expect(precheck(file("actually-a-jpeg.png", 400_000))).toBeNull();
  });

  it("accepts four extensions for three types", () => {
    expect([...ACCEPTED_EXTENSIONS]).toEqual(["jpg", "jpeg", "png", "webp"]);
  });
});

describe("what the server refused, and why", () => {
  it("reads 413 as too large, with the cap the server actually applied", () => {
    /*
     * `max_bytes` comes off the response rather than the constant: the cap is
     * raisable with `AC_MEDIA_MAX_BYTES` and PHP's own limit can be lower than
     * either, so a client trusting its own arithmetic would be wrong in both
     * directions.
     */
    expect(
      classifyRefusal(413, "file_too_large", { size: 9_000_000, max_bytes: 4_194_304 }, "…"),
    ).toEqual({ kind: "too_large", size: 9_000_000, maxBytes: 4_194_304 });
  });

  it("reads a 400 with a size as the truncation floor", () => {
    expect(classifyRefusal(400, "invalid_upload", { size: 0 }, "…")).toEqual({
      kind: "too_small",
      size: 0,
    });
  });

  it("reads a 400 without a size as a hostile filename", () => {
    // `shell.php.jpg` — measured, 400 "The filename contains a disallowed
    // extension." with no details at all.
    expect(classifyRefusal(400, "invalid_upload", {}, "…")).toEqual({ kind: "bad_filename" });
  });

  it("separates the three 415s, which share a code and differ only in details", () => {
    // The user picked a `.gif`: the extension never reached the sniffer.
    expect(classifyRefusal(415, "unsupported_media_type", { extension: "gif" }, "…")).toEqual({
      kind: "bad_extension",
      extension: "gif",
    });

    // A real PDF called `.png`, over the size floor so the sniffer ran.
    expect(
      classifyRefusal(415, "unsupported_media_type", { detected: "application/pdf" }, "…"),
    ).toEqual({ kind: "not_an_image", detected: "application/pdf" });

    /*
     * **The one the specification does not have a message for.** A real JPEG
     * renamed `.png`: both facts present, so the file *is* an accepted image and
     * simply is not the type its name claims. "Only jpg, png and webp are
     * accepted" would read as false to somebody looking at a file called `.png`,
     * and the fix is to re-export it rather than to pick a different file.
     */
    expect(
      classifyRefusal(
        415,
        "unsupported_media_type",
        { extension: "png", detected: "image/jpeg" },
        "The file contents do not match its extension.",
      ),
    ).toEqual({ kind: "contents_disagree", extension: "png", detected: "image/jpeg" });
  });

  it("keeps the API's own sentence for a code it has no branch for", () => {
    expect(classifyRefusal(500, "internal_error", {}, "Something broke.")).toEqual({
      kind: "other",
      message: "Something broke.",
    });
  });

  it("classifies on code and details, never on the message", () => {
    // The message is English prose the API is free to reword, and the panel is
    // French and Arabic. Same details, different wording, same classification.
    const a = classifyRefusal(415, "unsupported_media_type", { extension: "gif" }, "One thing");
    const b = classifyRefusal(415, "unsupported_media_type", { extension: "gif" }, "Another");
    expect(a).toEqual(b);
  });
});

describe("byte counts for a person", () => {
  it("uses the reader's decimal separator", () => {
    // A comma in French, and the unit is not translated — `Mo` is the French
    // form and Arabic renders the abbreviation the way it renders `DA`.
    expect(formatBytes(8 * 1024 * 1024, "fr-DZ")).toBe("8 Mo");
    expect(formatBytes(1_572_864, "fr-DZ")).toBe("1,5 Mo");
  });

  it("steps down to Ko and bytes", () => {
    expect(formatBytes(2048, "fr-DZ")).toBe("2 Ko");
    expect(formatBytes(700, "fr-DZ")).toBe("700 o");
    expect(formatBytes(0, "fr-DZ")).toBe("0 o");
  });

  it("renders in Arabic without throwing", () => {
    // The digits are whatever the locale asks for; the assertion is that a
    // locale the panel actually ships does not fall over.
    expect(formatBytes(1_572_864, "ar-DZ")).toMatch(/Mo$/);
  });
});

/**
 * ── The library's URL state, and the four orders that ship ───────────────────
 *
 * `orderby` measured 2026-08-28 against the live API: `date asc` differs from
 * the resting order, `date desc` is byte-identical to the bare listing, and
 * `title` — unprovable in August while 42 of 43 rows shared the title "Tapis" —
 * was proved in both directions once five rows spread across the id range were
 * renamed to titles whose alphabetical order matches neither their ids nor their
 * dates.
 *
 * What these pin is the panel's half: that the chip a reader sees, the URL they
 * can share and the request that is sent are three views of one value. That is
 * the property `mediaKey` depends on, and a screen whose chip disagrees with its
 * own request is a screen that lies about the state it is in.
 */
describe("the media library's sort", () => {
  it("round-trips every order through the URL", () => {
    for (const order of MEDIA_ORDERS) {
      const query = { search: "tapis", order };
      expect(queryFromParams(toUrlParams(query))).toEqual(query);
    }
  });

  it("asks for the pair the chip means, and asks for nothing at rest", () => {
    const read = (order: MediaOrder) => {
      const params = listParams({ search: "", order }, 1);
      return [params.get("orderby"), params.get("order")];
    };

    // The resting order sends no `orderby` at all: `date desc` was measured
    // byte-identical to the bare listing, so asking for it explicitly is a
    // parameter that changes nothing in every URL for ever.
    expect(read("newest")).toEqual([null, null]);
    expect(read("oldest")).toEqual(["date", "asc"]);
    expect(read("az")).toEqual(["title", "asc"]);
    expect(read("za")).toEqual(["title", "desc"]);
  });

  it("falls back to resting for a sort the chips could not show", () => {
    // `id` sorts at the API and is deliberately not offered — id order and date
    // order are the same fact on this collection. A hand-edited `?orderby=id` is
    // a legal 200 no chip could represent afterwards, so it resolves to rest
    // rather than leaving the group with nothing highlighted.
    expect(queryFromParams(new URLSearchParams("orderby=id&order=asc")).order).toBe("newest");
    // And `?orderby=zzz` is a measured 400, which a URL must not be able to
    // provoke into an error screen.
    expect(queryFromParams(new URLSearchParams("orderby=zzz")).order).toBe("newest");
    // A missing `order` is `desc`, which is `MediaController::indexArgs()`' own
    // default — so `?orderby=title` alone is Z→A rather than half a state.
    expect(queryFromParams(new URLSearchParams("orderby=title")).order).toBe("za");
    expect(queryFromParams(new URLSearchParams("order=asc")).order).toBe("oldest");
  });
});
