import { NextResponse } from "next/server";
import { getToolCatalog } from "@/server/services/tools";

/**
 * `/api/tools` — what Orion can do, without starting a run.
 *
 * Returns registered tool metadata only: id, name, description, version and the
 * capabilities each tool requires, plus the capabilities a run is granted. It
 * exposes no `execute` function, no Zod schema and no input the runtime accepts
 * — a tool's behaviour is reachable only through an agent execution, never
 * through this endpoint.
 *
 * The pairing with `/api/agent/capabilities` is intentional rather than
 * redundant. That endpoint answers "is the engine usable at all?" — the
 * provider, and the ids a run would carry. This one answers "what can those
 * tools do?", which is a longer answer that belongs on its own route rather
 * than bloating a status panel's payload.
 *
 * Resolved per request: the catalogue is fixed at build time today, but the
 * grant is configuration, and a static render would bake in whatever the build
 * machine happened to allow.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getToolCatalog());
}
