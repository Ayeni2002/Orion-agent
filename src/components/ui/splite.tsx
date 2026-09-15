"use client";

import dynamic from "next/dynamic";

/**
 * The Spline scene loader.
 *
 * Client-only, and deliberately through `next/dynamic` rather than the
 * `React.lazy()` + `Suspense` pair this component is usually written with.
 * Next's own docs (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`)
 * are explicit that a lazily-rendered Client Component is *prerendered on the
 * server* by default; `ssr: false` is the documented way to opt out. That
 * matters here because `@splinetool/react-spline` imports `@splinetool/runtime`
 * at module scope, and this card renders on `/` — a statically prerendered
 * route. Loading the runtime in the browser avoids evaluating a WebGL renderer
 * during `next build`, and removes any chance of a server/client markup
 * mismatch in the canvas.
 *
 * The cost is that the scene appears after hydration. That is the same
 * behaviour the `lazy()` version would have had visually, and the fallback
 * below covers the gap.
 */
const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => <ScenePlaceholder />,
});

export interface SplineSceneProps {
  /** URL of the exported `.splinecode` scene. */
  scene: string;
  className?: string;
}

export function SplineScene({ scene, className }: SplineSceneProps) {
  return <Spline scene={scene} className={className} />;
}

/**
 * Shown while the runtime downloads.
 *
 * The original of this component rendered `<span className="loader" />`, but no
 * `.loader` rule exists in `src/app/globals.css` — or anywhere else in this
 * project — so the fallback was an empty, invisible span. This is the same
 * intent built from Tailwind utilities, so it needs no new global CSS. The
 * scene sits on a near-black card, hence the light-on-dark border colours.
 */
function ScenePlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span
        aria-hidden
        className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
      />
      <span className="sr-only">Loading 3D scene</span>
    </div>
  );
}
