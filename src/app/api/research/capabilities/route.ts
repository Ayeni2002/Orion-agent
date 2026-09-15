import { NextResponse } from "next/server";
import { getResearchCapabilities } from "@/server/services/research";

/**
 * `/api/research/capabilities` — what research can currently do.
 *
 * Exists for the reason its agent counterpart does, and for one more that is
 * specific to this phase. The agent endpoint answers "which tools are
 * registered?"; this one answers a question the tool catalogue deliberately
 * cannot, because `research.search` is registered per run rather than in the
 * default catalogue: *can this build retrieve anything at all?*
 *
 * That is worth asking before a question is typed. A deployment with no search
 * configured returns `search_not_configured` from every run — honestly, and with
 * an explanation — but a user who learns it here has not waited for a run to
 * find out. `grantedCapabilities` is reported for a related reason: it is the one
 * place in Orion where the deny-by-default tool grant is widened, and a widened
 * grant that nothing states is a grant nobody reviews.
 *
 * Resolved per request rather than at build time: reading it during a static
 * render would bake in whatever the build machine's environment happened to say,
 * which is not necessarily the environment the app is running in. The export
 * below is what makes that true rather than merely intended.
 *
 * Never returns a credential. The provider descriptor carries an id, a label, a
 * model name and an external flag, and the API key is not read on this path at
 * all — `getModelProviderConfig` reports only whether a key is present, and
 * `readModelApiKey` is the single function that returns it.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getResearchCapabilities());
}
