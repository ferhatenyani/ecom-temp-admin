"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlobalAttribute } from "@/lib/api/schemas/product";
import { BrowserApiError, acRead, acWriteWithMeta } from "@/lib/api/browser";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, NavList, NavRow } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Form";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import {
  attributeCreateBody,
  normaliseSlug,
  slugTooLong,
  splitFieldErrors,
} from "./attribute-write";

/**
 * The shop's vocabulary: every global attribute, and the form that adds one.
 *
 * ## Why this is a destination and not a screen inside `/products`
 *
 * `content/faqs/categories/page.tsx` states the rule this screen is an exception
 * to — *"no nav entry for a screen you go **to** from somewhere"* — and
 * `nav-tree.ts` carries the argument for the exception. The short version:
 * `/inventory/movements` and `/shipping/rules` are only wanted while you are on
 * the screen above them, and attributes are the one vocabulary here you set up
 * **before** the thing that uses it exists. A shop's first session is Colour,
 * Size, then a product — with no product to have arrived from.
 *
 * It is also what `ProductDetail` defers to, in the sentence explaining why the
 * product form refuses to send `attributes` at all: replacing a variable
 * product's attribute list drops its *variation* attribute and WooCommerce then
 * clears every variation's map, measured on products 12 and 21. This screen does
 * not contradict that and could not: it writes the **global** vocabulary —
 * `POST /attributes` and its terms — and never a product's `attributes` array.
 * Attaching an attribute to a product is a different write on a different route
 * and belongs to whoever builds it.
 *
 * ## Why the counts are not on these rows
 *
 * `AttributeController::index()` is explicit — *"The single read carries usage;
 * the list does not — two queries per row"* — so `term_count` and
 * `product_count` are absent here and a fixture that invented them would let a
 * warning be written against a number the shop never sends. The row says so in
 * the card's footnote rather than showing a dash, because a blank column reads
 * as zero and zero is the one answer that would make a delete look free.
 *
 * ## The create form is a card, not an overlay
 *
 * Two fields, and `CategoriesScreen`'s argument holds for two as it does for
 * one: an overlay puts a scrim and a focus trap between a person and a text box,
 * and the list it appends to is the thing they are looking at while they type.
 * The slug box is the second field and it earns its place — see `slugHint`: an
 * Arabic label derives an Arabic slug, and a long one is refused outright, so
 * the box is the only way through for a shop that names things in Arabic.
 */
export function AttributesScreen({
  locale,
  initialAttributes,
}: {
  locale: string;
  initialAttributes: GlobalAttribute[] | null;
}) {
  const t = useTranslations("attributes");
  const tStates = useTranslations("states");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  /**
   * The refusals with nowhere to go, and there is one class of them left.
   *
   * It used to be two. WooCommerce's own slug refusals arrived under
   * `fields.attribute` — a key no control has — and the fix round's item 8 moved
   * them onto `name` or `slug`, so those now land under a box like any other
   * validation error. What still reaches this banner is the **duplicate slug**:
   * a 409 whose message is WooCommerce's and already names the slug, with the
   * clashing value under `details.slug` and deliberately no `fields`, because
   * `fields` is the API's 400 channel and no conflict writes to it.
   *
   * And anything the API names that this form does not draw — `type`,
   * `order_by`, `terms` — which is what `splitFieldErrors` is for. A banner
   * above the form is where a person reading the box they just typed in will
   * actually see it.
   */
  const [formError, setFormError] = useState<string | null>(null);

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["attributes"],
    queryFn: async () => {
      const { data: rows } = await acRead<GlobalAttribute[]>("/attributes");
      return rows;
    },
    initialData: initialAttributes ?? undefined,
  });

  const attributes = data ?? [];

  const clearErrors = () => {
    setNameError(undefined);
    setSlugError(undefined);
    setFormError(null);
  };

  const create = useMutation({
    mutationFn: () =>
      acWriteWithMeta<GlobalAttribute>("POST", "/attributes", attributeCreateBody({ name, slug })),
    onSuccess: ({ meta }) => {
      setName("");
      setSlug("");
      clearErrors();
      /*
       * **`meta.filterable` is the answer to the trap ADMIN_PANEL.md §88 spends
       * a section on**, and it is worth putting in front of a person rather than
       * dropping. `wc_create_attribute()` leaves the taxonomy unregistered for
       * the rest of the request, so WooCommerce's own REST controller cannot
       * take a term on an attribute it just made; the plugin registers it in the
       * same request and reports whether that worked. `true` means the attribute
       * can be filtered on now — and the toast still says what is *not* true
       * yet, which is that it counts zero products until one is tagged and
       * published.
       */
      toast.show(meta.filterable === true ? t("createdFilterable") : t("created"));
      void queryClient.invalidateQueries({ queryKey: ["attributes"] });
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const { bound, loose } = splitFieldErrors(caught.fields, ["name", "slug"]);
        setNameError(bound.name);
        setSlugError(bound.slug);
        /*
         * Three shapes, and the banner takes the two a control cannot:
         *
         *   400 fields.name / fields.slug   bound above, banner stays empty —
         *                                   and since the fix round's item 8
         *                                   this includes WooCommerce's own
         *                                   too-long and reserved-word
         *                                   refusals, which used to arrive
         *                                   under `fields.attribute` and show
         *                                   nowhere at all
         *   400 fields.<anything else>      `type`, `order_by`, `terms` — real
         *                                   keys this form draws no box for,
         *                                   collected by `loose`
         *   409 details.slug, no fields     only `message` is renderable, and
         *                                   it is WooCommerce's and names the
         *                                   slug
         *
         * The last branch is why the fallback is conditional rather than
         * unconditional: a plain 400 that named `name` would otherwise get its
         * sentence twice, once under the box and once above the form.
         */
        if (loose.length > 0) setFormError(loose.join(" "));
        else if (bound.name === undefined && bound.slug === undefined) {
          setFormError(caught.message);
        }
        return;
      }
      if (caught instanceof Error) {
        setFormError(caught.message);
        return;
      }
      throw caught;
    },
  });

  const trimmedName = name.trim();
  const normalised = normaliseSlug(slug);
  /* The one refusal the panel makes on its own, because it is certain and does
     not depend on the shop: over the byte budget is a 400 every time. */
  const tooLong = normalised !== "" && slugTooLong(normalised);
  const blocked = trimmedName === "" || tooLong;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={<span data-testid="attributes-count">{t("count", { total: attributes.length })}</span>}
        actions={
          <IconButton
            label={t("refresh")}
            icon="refresh"
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
          />
        }
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {(!online || isError) && dataUpdatedAt > 0 ? (
            <StaleBanner
              time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
              reason={online ? "refreshFailed" : "offline"}
            />
          ) : null}

          {isPending && attributes.length === 0 ? (
            <CardSkeleton rows={3} label={t("loading")} footnote={1} />
          ) : isError && attributes.length === 0 ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : attributes.length === 0 ? (
            /* One empty state, because this list takes no filters. It offers
               nothing: the create card is the next block down and is always on
               screen. `emptyDetail` says what the absence costs — §82's rule
               that only a global attribute can be filtered or counted. */
            <EmptyState icon="tag" message={t("empty")} detail={t("emptyDetail")} />
          ) : (
            <Card footnote={t("listNote")} flush>
              <div className="px-4 sm:px-5">
                <NavList>
                  {attributes.map((attribute) => (
                    <NavRow
                      key={attribute.id}
                      href={`/${locale}/attributes/${attribute.id}`}
                      label={decodeEntities(attribute.name)}
                      /*
                       * The taxonomy, not the slug, and both are on the row for
                       * the reason `AttributePresenter` exists to prevent
                       * confusing: the slug addresses the attribute here and the
                       * taxonomy is what a catalogue filter matches. Showing the
                       * one a person will paste into a filter is more useful,
                       * and it contains the other.
                       *
                       * `Ltr` because it is an identifier: `pa_couleur` inside
                       * an Arabic layout reorders without it, and a taxonomy
                       * read back wrong is a filter that matches nothing.
                       */
                      meta={<Ltr numeric={false}>{attribute.taxonomy}</Ltr>}
                    />
                  ))}
                </NavList>
              </div>
            </Card>
          )}

          <Card title={t("add")} description={t("intro")}>
            <div className="flex flex-col gap-3">
              {formError ? (
                <Notice tone="danger" role="alert" title={tStates("errorTitle")}>
                  {/* The API's own sentence as evidence, under a localised line
                      rather than standing in for one — `MediaDrawer`'s rule.
                      WooCommerce's three slug refusals are English and quote the
                      slug, so they are `Ltr` for the same reason the slug is. */}
                  <Ltr numeric={false} className="block text-ui-label">
                    {formError}
                  </Ltr>
                </Notice>
              ) : null}

              <TextField
                id="attribute-name"
                label={t("name")}
                value={name}
                onChange={(next) => {
                  setName(next);
                  /* The server's refusal was about the value that was sent, so
                     it stops being true the moment the value changes. */
                  if (nameError !== undefined) setNameError(undefined);
                  if (formError !== null) setFormError(null);
                }}
                hint={t("nameHint")}
                error={nameError}
              />

              <TextField
                id="attribute-slug"
                label={t("slug")}
                value={slug}
                onChange={(next) => {
                  setSlug(next);
                  if (slugError !== undefined) setSlugError(undefined);
                  if (formError !== null) setFormError(null);
                }}
                hint={t("slugHint")}
                /* The local check and the server's share one slot, and the local
                   one wins while it applies: it is about what is in the box now,
                   and the server's is about what was sent. */
                error={tooLong ? t("slugTooLong") : slugError}
              />

              <div>
                <Button
                  icon="plus"
                  onClick={() => create.mutate()}
                  loading={create.isPending}
                  disabled={blocked}
                  /* §3.3: a disabled control says why, and says *which* of the
                     two reasons it is. */
                  title={
                    trimmedName === ""
                      ? t("addBlocked")
                      : tooLong
                        ? t("slugTooLong")
                        : undefined
                  }
                >
                  {t("addAction")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}
