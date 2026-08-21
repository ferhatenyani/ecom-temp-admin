"use client";

import { useTranslations } from "next-intl";
import { COMPOSER_STEPS, stepIndex, type ComposerStep } from "@/lib/campaigns";
import { Isolate } from "@/components/primitives/Ltr";

/**
 * Where you are in the sequence, and how far you may go.
 *
 * **Dots and a sentence, not five labelled tabs.** Five labels do not fit at the
 * 390px floor — "Audience · Contenu · Aperçu · Test · Envoi" is 44 characters
 * before any padding, and Arabic is longer — so the labels would truncate to
 * initials and stop being labels. The dots carry position, the sentence carries
 * the name, and the sentence is what a screen reader announces.
 *
 * A completed step is tappable and an unreached one is not. That asymmetry is the
 * whole reason a wizard is safe here: **backwards is always available**, so a
 * person who reaches the preview and sees `{{firstname}}` render empty can go
 * straight back to the content without losing anything. Forward is gated because
 * the step after depends on the step before — an audience that cannot resolve
 * makes the preview's count a lie.
 */
export function StepIndicator({
  step,
  furthest,
  onGoTo,
}: {
  step: ComposerStep;
  /** The furthest step the draft currently supports. */
  furthest: ComposerStep;
  onGoTo: (step: ComposerStep) => void;
}) {
  const t = useTranslations("campaigns");
  const current = stepIndex(step);
  const limit = stepIndex(furthest);

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {COMPOSER_STEPS.map((name, index) => {
          const reachable = index <= Math.max(current, limit);
          return (
            <li key={name} className="flex flex-1 items-center gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                disabled={!reachable}
                onClick={() => reachable && onGoTo(name)}
                className={[
                  "h-1.5 flex-1 rounded-full transition-opacity",
                  index === current
                    ? "bg-accent"
                    : index < current
                      ? "bg-accent opacity-40"
                      : "bg-separator",
                  reachable ? "press" : "",
                ].join(" ")}
              />
            </li>
          );
        })}
      </ol>

      {/*
        The accessible name of the whole control, and the visible one. A
        translated sentence carrying two numbers, so `Isolate` and never `Ltr`:
        forcing LTR would lay "الخطوة ٢ من ٥" out from the left and put the
        number an Arabic reader meets first at the far end.
      */}
      <p className="text-footnote text-label-secondary" aria-live="polite">
        <Isolate numeric>
          {t("stepOf", { current: current + 1, total: COMPOSER_STEPS.length })}
        </Isolate>
        <span className="mx-1" aria-hidden="true">
          ·
        </span>
        <span className="text-label">{t(`step.${step}`)}</span>
      </p>
    </div>
  );
}
