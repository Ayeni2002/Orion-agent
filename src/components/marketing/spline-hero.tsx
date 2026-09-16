"use client";

import type { ReactNode } from "react";

import { SplineScene } from "@/components/ui/splite";
import { Spotlight } from "@/components/ui/spotlight";

/** The exported scene this hero renders. */
const SCENE_URL =
  "https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode";

interface SplineHeroProps {
  /**
   * The copy rendered over the scene.
   *
   * Passed in rather than hard-coded so the landing page keeps ownership of its
   * own words — this component owns layout and the 3D, nothing else.
   */
  children: ReactNode;
}

/**
 * The landing-page 3D hero: a full-viewport scene with the page's copy over it.
 *
 * ## Why the scene is a background layer
 *
 * The usual arrangement puts the scene in one flex half and the copy in the
 * other, which reads well but makes the 3D dead everywhere the text is. That is
 * not a styling accident — it is how `@splinetool/runtime` (v2.0.51) is built.
 * Two verified facts from its source decide this layout:
 *
 *   1. Input is bound to the canvas, not to the document:
 *      `this.eventContext.domElement.addEventListener("pointermove", ...)`,
 *      where `domElement` is the `<canvas>` handed to `new Application(canvas)`.
 *   2. The handler only acts when the event's *target* is that canvas:
 *      `domElement || "SPLINE-VIEWER" === e.target.tagName`.
 *
 * So if any element sits on top of the canvas and accepts pointer events, the
 * target becomes that element, rule 2 rejects it, and the model stops
 * responding. A transparent overlay does not fix this either: `pointer-events`
 * is a property of the element, not of its pixels, so an overlay with
 * `background: transparent` still swallows the event.
 *
 * Hence: the canvas is the full-bleed layer and the copy above it is
 * `pointer-events-none`, so the pointer passes *through* the text to the canvas
 * underneath. The scene is never given `pointer-events-none`, which would break
 * the very interaction it exists for.
 *
 * The canvas sizes itself from `canvas.parentElement.clientHeight/clientWidth`,
 * which is why the scene sits inside an `absolute inset-0` box rather than
 * being positioned directly — that box is the parent whose measured size the
 * runtime fills. It needs a parent with a resolved height, which the section's
 * `min-h` provides.
 *
 * ## The pointer-events contract for `children`
 *
 * The overlay is `pointer-events-none`, so **anything interactive passed in as a
 * child must opt back in with `pointer-events-auto`** — buttons, links, inputs.
 * Without that they render correctly but cannot be clicked, because the pointer
 * goes straight through them to the canvas.
 *
 * That is a deliberate split rather than a blanket rule. Text falls through so
 * the model keeps tracking under the cursor; controls do not, because a control
 * that cannot be clicked is a bug, while hero text that cannot be selected is a
 * cost worth paying for the interaction.
 *
 * ## Height
 *
 * The section is `calc(100svh - 3.5rem)`, where `3.5rem` is `SiteHeader`'s
 * `h-14`. The header is `sticky`, not `fixed`, so it occupies real space in the
 * flow and the hero already starts below it; subtracting that height is what
 * lands the hero's bottom edge on the viewport's bottom edge on first paint
 * rather than overflowing by one header. `svh` rather than `vh` so mobile
 * browser chrome does not push the last slice of the scene off-screen.
 *
 * Those two values are coupled: change `SiteHeader`'s height and the arbitrary
 * value here has to change with it. It is written as a literal on purpose —
 * Tailwind extracts class names by scanning source text and cannot see through a
 * template interpolation, so parameterising it would silently drop the class.
 */
export function SplineHero({ children }: SplineHeroProps) {
  return (
    <section className="relative flex min-h-[calc(100svh-3.5rem)] w-full items-center overflow-hidden bg-black/[0.96]">
      {/*
        The full-bleed interaction layer. `aria-hidden` because the scene is
        decorative — the copy over it carries the meaning.
      */}
      <div aria-hidden className="absolute inset-0 z-0">
        <SplineScene scene={SCENE_URL} className="h-full w-full" />
      </div>

      {/*
        Positioned like the original. It is `pointer-events-none` internally, so
        it neither blocks the canvas below it nor its own parent's mousemove.
      */}
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="white" />

      {/*
        The content overlay. Sits above the scene by z-index but is transparent
        to the pointer, so every part of the hero still drives the model. See the
        contract above before adding anything interactive in here.
      */}
      <div className="pointer-events-none relative z-10 w-full">{children}</div>
    </section>
  );
}
