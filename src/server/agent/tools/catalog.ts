import { textAnalysisTool } from "./builtin/text-analysis";
import { createToolRegistry, type ToolRegistry } from "./registry";

/**
 * The Orion tool catalogue.
 *
 * This is the one place that decides which tools a run can call. It is the
 * whole of "what Orion can do" — the registry is a lookup, the executor is a
 * pipeline, and neither names a tool; only this file does.
 *
 * Adding a tool is a one-line change here plus the tool's own module and tests.
 * Nothing in the planner, the executor, the runner or the API changes, which is
 * the property the registry seam exists to provide. `docs/TOOL_SYSTEM.md`
 * documents the full procedure, including the order the capability declaration
 * must be written in.
 *
 * The catalogue is intentionally tiny and fully read-only. Every entry declares
 * exactly `read_only`, so the default permission satisfies all of them; a tool
 * needing `network` would be registered here and then refused at runtime until
 * someone widened the grant on purpose. No such tool is registered, and the
 * Phase 4 boundary rules out adding one.
 */

/**
 * Builds the registry for a run: a fresh one, holding the catalogue.
 *
 * A function rather than a shared singleton, for the reason Phase 3 recorded
 * when it introduced this shape: a process-wide mutable registry would let one
 * run's registrations leak into another's. Registries are cheap and the tool
 * definitions they point at are module constants, so nothing is copied per run
 * beyond a map of a handful of references.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = createToolRegistry();

  registry.register(textAnalysisTool);

  return registry;
}
