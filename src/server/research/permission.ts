import { ToolPermission } from "@/server/agent";

/**
 * The one widened tool grant in Orion.
 *
 * §6 of the Phase 5 brief asks for read-only network permissions, denied by
 * default. This constant is the whole of the exception, and it is a module of
 * its own rather than a line inside the service for one reason: a widened grant
 * should be findable. Anyone asking "where can Orion reach the network?" should
 * be able to grep for the grant and land on a file that answers the question in
 * its first paragraph.
 *
 * Three properties make this as small as it can be.
 *
 * **It is not the default, and the default did not move.**
 * `DEFAULT_TOOL_PERMISSION` is still `ToolPermission.only("read_only")`, and
 * nothing here changes it. Every agent run, every test that constructs an
 * executor without arguments, and `/api/tools` still report exactly what they
 * reported in Phase 4. Widening the default instead would have granted network
 * access to runs that never asked for it, which is the failure mode deny-by-
 * default exists to prevent.
 *
 * **It is held, not passed.** `ToolExecutor` takes its permission as a
 * constructor argument, so there is no per-call parameter through which a caller
 * could grant itself anything. A run gets this permission only by being
 * constructed with it, and only the research service does that.
 *
 * **It is per-run, never global.** The value is a constant, but the *grant* is
 * per-executor: a research run's executor holds it for the duration of that run
 * and no other executor in the process has it. There is no environment variable
 * that widens the default, and no configuration flag that could — a widened
 * grant reachable from configuration is a grant nobody reviews.
 *
 * `read_only` is included alongside `network` because a research run also uses
 * the ordinary read-only tools the Phase 4 catalogue provides, and a tool
 * declares all the capabilities it needs. The two are independent: granting
 * `network` does not imply `read_only`, and the search tool declares only
 * `network` because reaching the network is the only thing it needs that the
 * default does not already give it.
 */
export const RESEARCH_TOOL_PERMISSION: ToolPermission = ToolPermission.only(
  "read_only",
  "network",
);
