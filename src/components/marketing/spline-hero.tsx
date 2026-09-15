"use client";

import { Card } from "@/components/ui/card";
import { SplineScene } from "@/components/ui/splite";
import { Spotlight } from "@/components/ui/spotlight";

/** The exported scene this hero renders. */
const SCENE_URL =
  "https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode";

/**
 * The landing-page 3D hero.
 *
 * ## Why the scene covers the whole card
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
 * responding — exactly the reported symptom. A transparent overlay does not fix
 * this either: `pointer-events` is a property of the element, not of its
 * pixels, so an overlay with `background: transparent` still swallows the
 * event.
 *
 * Hence: the canvas is the full-card layer and the copy above it is
 * `pointer-events-none`, so the pointer passes *through* the text to the
 * canvas underneath. The scene is never given `pointer-events-none`, which
 * would break the very interaction it exists for.
 *
 * The canvas sizes itself from `canvas.parentElement.clientHeight/clientWidth`,
 * which is why the scene sits inside an `absolute inset-0` box rather than
 * being positioned directly — that box is the parent whose measured size the
 * runtime fills.
 *
 * The copy is laid out on the left half so the composition still reads as two
 * sides, even though the scene technically spans the card.
 *
 * ## Trade-off
 *
 * `pointer-events-none` on the overlay means this copy cannot be selected or
 * copied with the mouse. That is the accepted cost of full-card interaction for
 * decorative hero text; it would not be acceptable for body copy or for any
 * link or button placed in the overlay, since those would stop being clickable.
 */
export function SplineHero() {
  return (
    <Card className="relative h-[500px] w-full overflow-hidden bg-black/[0.96]">
      {/*
        The full-card interaction layer. `aria-hidden` because the scene is
        decorative — the copy beside it carries the meaning.
      */}
      <div aria-hidden className="absolute inset-0 z-0">
        <SplineScene scene={SCENE_URL} className="h-full w-full" />
      </div>

      {/*
        Positioned like the original. It is `pointer-events-none` internally, so
        it neither blocks the canvas below it nor its own parent's mousemove.
      */}
      <Spotlight
        className="-top-40 left-0 md:-top-20 md:left-60"
        fill="white"
      />

      {/*
        The content overlay. Sits above the scene by z-index, but is transparent
        to the pointer so every part of the card still drives the model.
      */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-center p-8 md:w-1/2">
        <h2 className="bg-gradient-to-b from-neutral-50 to-neutral-400 bg-clip-text text-4xl font-bold text-transparent md:text-5xl">
          Research you can verify
        </h2>

        <p className="mt-4 max-w-lg text-neutral-300">
          Orion plans the work, searches the web, and cites the sources it used —
          so every claim traces back to a page you can open.
        </p>
      </div>
    </Card>
  );
}
