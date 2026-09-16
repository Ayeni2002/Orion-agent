import { NextResponse } from "next/server";
import { getEngineCapabilities } from "@/server/services/agent";

/**
 * `/api/agent/capabilities` — what the engine can currently do.
 *
 * Exists so the workspace can be honest *before* a run is started rather than
 * only after one fails. It reports the resolved provider — whether inference is
 * external, and which model — alongside the tools the run will be able to call,
 * so a reader learns up front that a step needing a capability this build does
 * not have will be reported as unavailable, instead of discovering it from a
 * failed step.
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
