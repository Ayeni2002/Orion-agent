import { NextResponse } from "next/server";
import { getEngineCapabilities } from "@/server/services/agent";

/**
 * `/api/agent/capabilities` — what the engine can currently do.
 *
 * Exists so the workspace can be honest *before* a run is started rather than
 * only after one fails. Phase 3 registers no tools, so a reader learns here
 * that a step needing an external capability will be reported as unavailable,
 * instead of discovering it from a failed step.
 *
 * Resolved per request rather than at build time: reading it during a static
 * render would bake in whatever the build machine's environment happened to
 * say, which is not necessarily the environment the app is running in. The
 * export below is what makes that true rather than merely intended.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getEngineCapabilities());
}
