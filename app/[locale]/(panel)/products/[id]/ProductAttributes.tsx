"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type {
  AttributeTerm,
  GlobalAttribute,
  Product,
  Variation,
} from "@/lib/api/schemas/product";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { splitFieldErrors } from "../../attributes/attribute-write";
import {
  attach,
  attachedFrom,
  attributesBody,
  detach,
  isGlobal,
  mappingLosses,
  variationKey,
  withOption,
  withRole,
  withVisible,
  type Attached,
  type MappingLoss,
} from "./variable-product";
import { useOnline } from "@/lib/use-online";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/States";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { CheckRow, ChoiceGroup, ErrorSummary, Select, Switch } from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";

/**
 * Which attributes this product uses, which of their terms, and **which of them
 * split the product into things with their own price**.
 *
 * ## This card is the deferral being reversed, and it is its own write
 *
 * `variable-product.ts` carries the whole argument and it should be read before
 * this file. The short version: `ProductRepository::update()` calls
 * `set_attributes()`, which is a **whole-list replace**, so a partial attribute
 * list deletes the attributes it omits and orphans every variation that depended
 * on them. The list this card sends is always complete — every entry the product
 * carries, local ones included, whether or not this screen draws a control for
 * it.
 *
 * **It PATCHes `{attributes: […]}` alone, and that is deliberate rather than
 * convenient.** `ProductDetail`'s form sends a hand-written subset of writable
 * keys on *every* save, and its docblock keeps `attributes` out of that list.
 * Adding it there would mean the attribute list is rewritten whenever anybody
 * fixes a typo in a description — so any drift between what the page read and
 * what is now stored (a term deleted from the attributes screen, a second tab, a
 * colleague) would silently rewrite the variation mapping on an unrelated save.
 * A separate write only fires when this card is dirty, and `attributesBody()`
 * answers `null` when it is not.
 *
 * ## Spec or variant, in words a shopkeeper uses
 *
 * WooCommerce calls the flag `variation` and puts it on screen as a checkbox
 * labelled "Used for variations", which is a sentence about the software.
 * §82's real distinction is about the *shop*: a **caractéristique** is something
 * true of every copy of this product — it is printed on the page and a shopper
 * can filter by it — and a **déclinaison** is a fork in the product, where each
 * value becomes its own line with its own price, SKU and stock.
 *
 * So the control is a two-option choice naming those two outcomes, with the
 * consequence spelled out under each, and the word "variation" appears nowhere
 * in it. Choosing *déclinaison* is what makes the variations table below this
 * card able to exist at all.
 *
 * **The choice is locked to *caractéristique* while the product is not
 * `variable`**, and the reason is the API's own sentence:
 * `VariationService::requireVariableParent()` answers 409 *"Only variable
 * products have variations. Set the product type to \"variable\" first."* A
 * control that let somebody mark an axis on a simple product would produce a
 * saved flag and a variations table that refuses every write, which is worse
 * than a locked control that names the field to change. The type control is on
 * the identity card directly above.
 *
 * ## The three edits that destroy rows, counted before they fire
 *
 * Detaching an attribute, turning a *déclinaison* back into a
 * *caractéristique*, and un-ticking a term some variation is using all end the
 * same way: a variation whose combination the parent no longer offers.
 * `mappingLosses()` names exactly which rows, and the confirmation carries the
 * number. This is the only destructive path on the card and it is the only one
 * that asks.
 *
 * ## What this card does not edit
 *
 * A **local** attribute's option strings. `id: 0` means the values live on this
 * product alone with no shared vocabulary — §82 is explicit that only a global
 * attribute can be filtered or counted — and this screen has no vocabulary to
 * draw checkboxes from. The row is shown, its role and visibility are editable,
 * it can be detached, and its options ride back exactly as they were read. A
 * text box that split free strings on commas would be a second, quieter way to
 * lose a variation mapping, and the shop's answer to a local attribute is to
 * promote it on the attributes screen.
 */
export function ProductAttributes({
  product,
  variations,
  attributes,
  terms: initialTerms,
  onSaved,
}: {
  product: Product;
  /** `null` means the variation list could not load — see below. */
  variations: Variation[] | null;
  /** Every global attribute the shop defines. `[]` when `/attributes` failed. */
  attributes: GlobalAttribute[];
  /** Terms by taxonomy, for the attributes this product already carries. */
  terms: Record<string, AttributeTerm[]>;
  /** The parent re-seeds its product state from the write's response. */
  onSaved: (product: Product) => void;
}) {
  const t = useTranslations("products.variants");
  const tDetail = useTranslations("products.detail");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const confirmOpenerId = useId();

  const [draft, setDraft] = useState<Attached[]>(() => attachedFrom(product));
  /**
   * The vocabulary, which **grows**.
   *
   * `page.tsx` fetches the term lists for the attributes the product already
   * carries, and no others — the wave that used to fetch all four on every one of
   * this shop's 26 simple products was the products branch's own correction and
   * it stands. Attaching an attribute is the moment its terms are first needed,
   * so that is when they are fetched: one request at the moment of the act,
   * rather than four on every page view for a card nobody opened.
   */
  const [terms, setTerms] = useState(initialTerms);
  const [loadingTerms, setLoadingTerms] = useState<string | null>(null);
  const [adding, setAdding] = useState("");

  /** Bound to `attributes` — the one key the API names for this field. */
  const [error, setError] = useState<string | null>(null);
  /** Refusals naming a key no control has: `attributes[0].options`, and the rest. */
  const [loose, setLoose] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<MappingLoss[] | null>(null);

  const current = attachedFrom(product);
  const body = attributesBody(current, draft);
  const dirty = body !== null;

  /** The definition behind a row, when there is one. A local attribute has none. */
  const definitionOf = (attribute: Attached): GlobalAttribute | undefined =>
    attributes.find((definition) => definition.taxonomy === attribute.name);

  const labelOf = (attribute: Attached): string =>
    definitionOf(attribute)?.name ?? attribute.name;

  /** This attribute's terms, or `[]` for a local one, which has no vocabulary. */
  const vocabularyOf = (attribute: Attached): AttributeTerm[] =>
    terms[attribute.name] ?? [];

  const attached = new Set(draft.map(variationKey));
  const available = attributes.filter(
    (definition) => !attached.has(definition.taxonomy.toLowerCase()),
  );

  /**
   * The one refusal this card makes before asking, and it is the only one.
   *
   * `AttributeInput::options()` answers *"At least one option is required."* for
   * an empty list, keyed `attributes[{index}].options` — a key no control on this
   * screen has, so the message would arrive and land nowhere. It is also a
   * certain 400 that does not depend on the shop's state, which is the test
   * `attribute-write.ts` states for refusing locally at all: rule out what the
   * panel already knows, leave everything else to the server.
   */
  const empty = draft.filter((attribute) => attribute.options.length === 0);

  const blockedReason = !online
    ? tStates("offlineWrites")
    : empty.length > 0
      ? t("needsTerms", { name: labelOf(empty[0]) })
      : undefined;

  const save = useMutation({
    mutationFn: async () => {
      if (body === null) return null;
      return acWrite<Product>("PATCH", `/products/${product.id}`, body);
    },
    onMutate: () => {
      setError(null);
      setLoose([]);
    },
    onSuccess: (next) => {
      setConfirming(null);
      if (!next) return;
      onSaved(next);
      setDraft(attachedFrom(next));
      toast.show(t("saved"));
      /* The variations table below reads from the server render, and the save
         may have just changed which combinations are even legal. Refreshing the
         route is the only way the two stay agreed. */
      router.refresh();
    },
    onError: (failure: unknown) => {
      setConfirming(null);

      if (failure instanceof BrowserApiError) {
        /*
         * `splitFieldErrors()` is the attributes branch's, reused rather than
         * rewritten. Everything the API can say about this write arrives under
         * `details.fields`, and only one of the keys it uses — `attributes` — has
         * anywhere to go: `ProductRepository::buildAttributes()` reports *"Unknown
         * global attribute id 9."* and `resolveTermIds()` reports *"Unknown term
         * \"x\" for attribute pa_y."* under exactly that key, while
         * `AttributeInput::listFromPayload()` reports under `attributes[0]` and
         * `attributes[0].options`, which no control wears. The split puts the
         * first on the field and the rest on screen instead of dropping them.
         */
        const { bound, loose: orphans } = splitFieldErrors(failure.fields, ["attributes"]);
        setError(bound.attributes ?? (orphans.length === 0 ? failure.message : null));
        setLoose(orphans);
        return;
      }

      setError(t("saveFailed"));
    },
  });

  /**
   * Save, or ask first.
   *
   * `variations === null` means the section could not load, so the panel does not
   * know what it would break — and it asks anyway, saying so. Guessing "nothing"
   * from a failed request is how the mapping gets wiped by a screen that was
   * confident.
   */
  const attemptSave = () => {
    if (variations === null) {
      setConfirming([]);
      return;
    }

    const losses = mappingLosses(current, draft, variations);
    if (losses.length > 0) {
      setConfirming(losses);
      return;
    }

    save.mutate();
  };

  const addAttribute = async (taxonomy: string) => {
    const definition = attributes.find((row) => row.taxonomy === taxonomy);
    if (definition === undefined) return;

    setDraft((rows) => attach(rows, definition));
    setAdding("");

    if (terms[taxonomy] !== undefined) return;

    setLoadingTerms(taxonomy);
    try {
      const loaded = await acRead<AttributeTerm[]>(
        `/attributes/${definition.id}/terms?per_page=100`,
      );
      setTerms((held) => ({ ...held, [taxonomy]: loaded.data }));
    } catch {
      /* An empty vocabulary rather than a hole: the attribute is attached and
         carries no terms yet, which the row already says. The save is blocked by
         `empty` until somebody can pick one, and the reason names the attribute. */
      setTerms((held) => ({ ...held, [taxonomy]: [] }));
    } finally {
      setLoadingTerms(null);
    }
  };

  /**
   * One loss as a sentence a person can act on.
   *
   * The label is resolved against **`current`**, not `draft`, and that is the
   * whole reason this is a function rather than an inline template: the most
   * common loss is `detached`, and a detached attribute is by definition no
   * longer in the draft — looked up there it would fall through and put the raw
   * taxonomy `pa_couleur` in front of a shopkeeper, in the one dialog on this
   * screen whose entire job is to be read.
   */
  const lossLine = (loss: MappingLoss): string => {
    const attribute = current.find((row) => variationKey(row) === loss.key);

    return t(`loss.${loss.reason}`, {
      count: loss.variations.length,
      name: attribute === undefined ? loss.key : labelOf(attribute),
      values: loss.options.join(", "),
    });
  };

  return (
    <>
      <Card
        title={t("title")}
        description={t("description")}
        footnote={product.type === "variable" ? undefined : t("simpleNote")}
      >
        <div className="flex flex-col gap-4">
          {error !== null || loose.length > 0 ? (
            <ErrorSummary
              failures={[
                ...(error === null ? [] : [{ label: tDetail("attributes"), message: error }]),
                ...loose.map((message) => ({ message })),
              ]}
            />
          ) : null}

          {attributes.length === 0 && draft.length === 0 ? (
            <Notice tone="info" title={t("noVocabulary")}>
              <p className="text-ui-label">{t("noVocabularyBody")}</p>
            </Notice>
          ) : null}

          {draft.map((attribute) => {
            const key = variationKey(attribute);
            const global = isGlobal(attribute);
            const vocabulary = vocabularyOf(attribute);
            /* Every value the product carries, even one the vocabulary no longer
               lists — a term deleted on the attributes screen after this product
               was tagged still has a row, or the next save would drop it. */
            const extra = attribute.options.filter(
              (slug) => !vocabulary.some((term) => term.slug === slug),
            );

            return (
              <div
                key={key}
                className="flex flex-col gap-3 rounded-ui-lg border border-ui-line p-3"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span dir="auto" className="min-w-0 truncate text-ui-subheading text-ui-fg">
                        {labelOf(attribute)}
                      </span>
                      {global ? null : <Badge tone="neutral">{tDetail("localAttribute")}</Badge>}
                    </span>
                    {/*
                      The chosen values as a line, for **both** kinds now.
                      `pa_couleur` carries sixty terms in this shop and the
                      checkbox list below is all sixty of them — see the note on
                      the term list — so without this the answer to "which
                      colours is this product?" is only reachable by reading
                      sixty rows. Resolved to term *names*, because the stored
                      value is a slug and `bois-dolivier` is not an answer.
                    */}
                    <span dir="auto" className="text-ui-label text-ui-muted">
                      {attribute.options.length === 0
                        ? t("noneChosen")
                        : attribute.options
                            .map(
                              (slug) =>
                                vocabularyOf(attribute).find((term) => term.slug === slug)?.name ??
                                slug,
                            )
                            .join(", ")}
                    </span>
                  </div>
                  <IconButton
                    label={t("detach", { name: labelOf(attribute) })}
                    icon="close"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft((rows) => detach(rows, key))}
                  />
                </div>

                {/*
                  The spec/variant choice. Two options, each naming its outcome
                  rather than the flag it sets — see the docblock. Locked to the
                  first while the product is simple, with the API's own remedy as
                  the reason.
                */}
                <ChoiceGroup
                  label={t("role", { name: labelOf(attribute) })}
                  value={attribute.variation ? "variant" : "spec"}
                  disabled={product.type !== "variable"}
                  onChange={(next) =>
                    setDraft((rows) => withRole(rows, key, next === "variant"))
                  }
                  options={[
                    { value: "spec", label: t("roleSpec") },
                    { value: "variant", label: t("roleVariant") },
                  ]}
                />
                <p className="text-ui-label text-ui-subtle">
                  {attribute.variation ? t("roleVariantWhy") : t("roleSpecWhy")}
                </p>

                {global ? (
                  <div className="flex flex-col gap-1">
                    {/*
                      **Every term, never a truncated list.** `pa_couleur` has
                      sixty in this shop and all sixty are drawn, which is the
                      rule `lib/products.ts` argues at length for the filter
                      drawer one screen over — a facet omits its zero-count
                      values, so the term list is the only place the *whole*
                      vocabulary exists, and showing part of it turns the
                      unshown part into a value nobody can pick. The summary
                      line above the control is what makes a long list scannable
                      without shortening it.
                    */}
                    <p className="text-ui-label text-ui-muted">{t("terms")}</p>
                    {loadingTerms === attribute.name ? (
                      <p className="text-ui-label text-ui-subtle">{t("loadingTerms")}</p>
                    ) : vocabulary.length === 0 && extra.length === 0 ? (
                      <p className="text-ui-label text-ui-subtle">{t("noTerms")}</p>
                    ) : (
                      <>
                        {vocabulary.map((term) => (
                          <CheckRow
                            key={term.slug}
                            checked={attribute.options.includes(term.slug)}
                            label={term.name}
                            count={term.count}
                            onChange={(on) =>
                              setDraft((rows) =>
                                withOption(
                                  rows,
                                  key,
                                  term.slug,
                                  on,
                                  vocabulary.map((row) => row.slug),
                                ),
                              )
                            }
                          />
                        ))}
                        {/* A value the vocabulary does not explain. Shown as the
                            stored slug, because an unrecognised value is
                            information rather than a reason to render a blank. */}
                        {extra.map((slug) => (
                          <CheckRow
                            key={slug}
                            checked
                            label={slug}
                            secondary={t("unknownTerm")}
                            onChange={() =>
                              setDraft((rows) =>
                                withOption(
                                  rows,
                                  key,
                                  slug,
                                  false,
                                  vocabulary.map((row) => row.slug),
                                ),
                              )
                            }
                          />
                        ))}
                      </>
                    )}
                  </div>
                ) : null}

                <Switch
                  label={t("visible")}
                  checked={attribute.visible}
                  onChange={(next) => setDraft((rows) => withVisible(rows, key, next))}
                  hint={t("visibleHint")}
                />
              </div>
            );
          })}

          {available.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Select
                label={t("addLabel")}
                value={adding}
                onChange={setAdding}
                hint={t("addHint")}
                options={[
                  { value: "", label: t("addPlaceholder") },
                  ...available.map((definition) => ({
                    value: definition.taxonomy,
                    label: definition.name,
                    secondary: definition.taxonomy,
                  })),
                ]}
              />
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  disabled={adding === ""}
                  title={adding === "" ? t("addPlaceholder") : undefined}
                  onClick={() => void addAttribute(adding)}
                >
                  {t("add")}
                </Button>
              </div>
            </div>
          ) : null}

          {dirty ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id={confirmOpenerId}
                loading={save.isPending}
                disabled={blockedReason !== undefined}
                title={blockedReason}
                onClick={attemptSave}
              >
                {t("save")}
              </Button>
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(attachedFrom(product));
                  setError(null);
                  setLoose([]);
                }}
              >
                {t("discard")}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        The confirmation, and it is the (c) half of the deferral argument. Every
        line names a count of real rows, because "this may affect variations" is
        the warning everybody clicks through and "3 déclinaisons perdront leur
        identité" is not.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={t("confirmTitle")}
        body={
          <span className="flex flex-col gap-2">
            <span>{confirming?.length === 0 ? t("confirmUnknown") : t("confirmBody")}</span>
            {(confirming ?? []).map((loss) => (
              <span key={`${loss.key}-${loss.reason}`}>{lossLine(loss)}</span>
            ))}
          </span>
        }
        confirmLabel={t("confirmAction")}
        loading={save.isPending}
        returnFocusTo={confirmOpenerId}
        onConfirm={() => save.mutate()}
      />
    </>
  );
}
