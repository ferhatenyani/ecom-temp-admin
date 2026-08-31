import { describe, expect, it } from "vitest";
import { draftOf } from "@/app/[locale]/(panel)/marketing/campaigns/[id]/Composer";
import { campaign as campaignSchema } from "@/lib/api/schemas/campaign";
import type { Campaign } from "@/lib/api/schemas/campaign";
import fixtures from "./fixtures-campaigns.json";

/**
 * `draftOf()` — item 12's extraction, and the reason the rebind is testable at
 * all.
 *
 * The binding was an inline `useState` initialiser before this branch, which is
 * exactly why the composer never rebound: there was no function to call after a
 * save, only an initialiser that had already run once. Pulling it out is most of
 * the fix; these assertions pin the three properties that make calling it twice
 * safe.
 *
 * **What is not tested here, deliberately.** That `save()` calls it is a
 * component fact and this file makes no claim about it — `mail-preview.test.ts`
 * opens with the same distinction and for the same reason. What can be pinned is
 * that the projection states the server's row and decides nothing, because every
 * way of getting that wrong turns a rebind into a silent edit of somebody's
 * campaign.
 *
 * The base row is the **measured** `draft` fixture, parsed through the schema
 * rather than hand-written, so a campaign shape that drifts fails here rather
 * than being re-invented in a literal. It predates `body_fields`, which is
 * useful: the absent-column case is the one a hand-written fixture would forget.
 */

const BASE: Campaign = campaignSchema.parse(fixtures.draft.data);

function campaignWith(patch: Partial<Campaign>): Campaign {
  return { ...BASE, ...patch };
}

describe("draftOf", () => {
  it("states the server's row and nothing else", () => {
    const bound = draftOf(BASE, "fr");

    expect(bound.name).toBe(BASE.name);
    expect(bound.subject).toBe(BASE.subject);
    expect(bound.body_html).toBe(BASE.body_html);
    expect(bound.body_text).toBe(BASE.body_text);
    expect(bound.audience).toEqual({
      type: BASE.audience.type,
      segment_id: BASE.audience.segment_id,
      customer_ids: BASE.audience.customer_ids,
    });
  });

  it("never regenerates the bodies from the answers", () => {
    /*
     * The property `handEdited()` rests on. It regenerates from `body_fields` and
     * compares against the stored bodies, so a binding that rebuilt them here
     * would make the two equal by construction and the flag false for ever — the
     * screen would stop being able to report a hand edit at all.
     *
     * The disagreement below is the real one from step 7: `EmailHtml::sanitize()`
     * strips `<b>` from a `body_fields` string on the way in, so the stored body
     * and the answers stop agreeing. `draftOf` must carry both, unreconciled.
     */
    const bound = draftOf(
      campaignWith({
        body_html: "<p>Bonjour, la balise a disparu.</p>",
        body_fields: { paragraphs: ["Bonjour, la balise <b>a disparu</b>."] },
      }),
      "fr",
    );

    expect(bound.body_html).toBe("<p>Bonjour, la balise a disparu.</p>");
    expect(bound.body?.paragraphs).toEqual(["Bonjour, la balise <b>a disparu</b>."]);
  });

  it("keeps null and {} as the different claims they are", () => {
    /*
     * `null` is *this campaign has no answers* — hand-written HTML the panel must
     * never regenerate over — and opens the two text areas. `{}` is *the form was
     * used and every answer is blank*. A rebind that collapsed them would swap a
     * hand-written campaign onto the generated form on the first save, which is
     * the one edit this screen must never make by itself.
     */
    expect(draftOf(campaignWith({ body_fields: null }), "fr").body).toBeNull();
    expect(draftOf(campaignWith({ body_fields: {} }), "fr").body).not.toBeNull();
  });

  it("copies customer_ids rather than aliasing the query's array", () => {
    /*
     * The audience picker mutates the draft's list. Aliasing would move the row
     * inside react-query's cache underneath it — a store nothing in this screen
     * ever writes to on purpose, and one `audienceChanged` compares against.
     */
    const row = campaignWith({
      audience: { type: "ids", segment_id: 0, customer_ids: [7, 9] },
    });
    const bound = draftOf(row, "fr");

    bound.audience.customer_ids.push(11);

    expect(row.audience.customer_ids).toEqual([7, 9]);
  });

  it("takes the direction from the locale it is given", () => {
    /*
     * `readValues()` needs a direction for a campaign whose answers do not state
     * one. It is the *locale's*, not the panel's current one at render time —
     * which is the same rule the seed follows and the reason both take `locale`
     * as an argument rather than reading a context.
     */
    expect(draftOf(campaignWith({ body_fields: {} }), "ar").body?.direction).toBe("rtl");
    expect(draftOf(campaignWith({ body_fields: {} }), "fr").body?.direction).toBe("ltr");
  });
});
