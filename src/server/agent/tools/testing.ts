import { z } from "zod";

import type { ToolCapability, ToolOutput } from "@/types/agent";
import type { ToolDefinition, ToolExecutionContext } from "./definition";

/**
 * Builds a tool for tests.
 *
 * Follows the precedent `provider/stub-provider.ts` set: a test-only module
 * that lives beside the code it exercises, is deliberately NOT exported from
 * the module's public barrel, and is never reachable from a running engine. It
 * exists so that a test asserting on the registry, the executor or the plan
 * executor can build the exact tool it needs in one line, instead of every test
 * file re-declaring the same six fields and drifting from the interface as it
 * grows.
 *
 * The default schema accepts any object and the default execution succeeds,
 * which makes the common case — "a tool that works" — the shortest thing to
 * write, so a test only spells out the part it is actually about.
 */
export interface TestToolOptions {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  capabilities?: readonly ToolCapability[];
  inputSchema?: z.ZodType;
  execute?: (
    input: unknown,
    context: ToolExecutionContext,
  ) => Promise<ToolOutput>;
}

export const TEST_TOOL_ID = "test.echo";

export function createTestTool(options: TestToolOptions = {}): ToolDefinition {
  return {
    id: options.id ?? TEST_TOOL_ID,
    name: options.name ?? "Test echo",
    description: options.description ?? "A scripted tool, for tests only.",
    version: options.version ?? "1.0.0",
    capabilities: options.capabilities ?? ["read_only"],
    // A record schema rather than an object schema so a test can hand the
    // executor arbitrary input without the schema being the thing under test.
    inputSchema: options.inputSchema ?? z.record(z.string(), z.unknown()),
    execute: options.execute ?? (() => Promise.resolve({ echoed: true })),
  };
}
