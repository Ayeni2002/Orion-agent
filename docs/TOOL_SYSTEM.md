# Orion — Tool System

> **Status: Phase 4, implemented.** The tool system exists and runs, and the catalogue
> holds exactly one tool: `text.analyze`, a deterministic read-only text measurement.
> No tool reaches outside the process — there is no web search, browser automation,
> scraping, shell, code execution, filesystem or database access anywhere in this
> layer, and none is registered or stubbed.
>
> This document is the reference for the layer. [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> §7 records the shape and the reasoning; this file records the detail and the
> procedure.

## 1. What a tool is

A tool is a **named, versioned, declared capability with a typed input and a
structured output**, which the agent engine can call during a run instead of asking a
model to reason about something it cannot know.

Three things follow from that definition, and they are what separate this layer from a
function call:

- **It is declared.** A tool states what it can do (`name`, `description`), what it
  needs (`capabilities`) and what it accepts (`inputSchema`) before anything calls it.
  The planner selects from the declared catalogue by id; it cannot invent a tool.
- **It is a leaf.** A tool measures, reads or computes. It does not plan, does not
  decide whether the run succeeded, and cannot mark work complete.
- **It is recorded.** Every call produces a receipt, whether it succeeded or failed.

A tool is *not* an agent and *not* a model. It performs no inference, makes no
judgements, and returns the same output for the same input every time.

## 2. The vocabulary

Two halves, split along the same line the provider seam uses.

### Serializable — `src/types/agent.ts`

These cross the wire, so everything in them survives `JSON.stringify`.

| Type | What it is |
| --- | --- |
| `ToolCapability` | `"read_only" \| "network" \| "data_access" \| "user_action"` |
| `ToolInput` | `Record<string, unknown>` — what a tool is called with |
| `ToolOutput` | `Record<string, unknown>` — what a tool returns |
| `ToolExecutionStatus` | `"running" \| "succeeded" \| "failed"` |
| `ToolExecution` | the stored record of one call: id, step, tool, status, timestamps, input, output, error |
| `Tool` | the public projection of a tool — no executable parts |
| `ToolCatalog` | what `/api/tools` returns: the tools plus the granted capabilities |

### Executable — `src/server/agent/tools/definition.ts`

These hold a Zod schema and a function, neither of which survives serialisation, so they
cannot live in the domain-types module.

| Type | What it is |
| --- | --- |
| `ToolDefinition` | the full tool: metadata + `capabilities` + `inputSchema` + `execute` |
| `ToolExecutionContext` | everything a tool is given about the run |
| `ToolReceipt` | `ToolExecution` plus `executionId` and `taskId` — the audit record |
| `ToolPermission` | the set of capabilities a run is granted |

`Tool` is a **projection** of `ToolDefinition`, not a parallel concept:
`ToolRegistry.list()` drops `execute` and `inputSchema` and returns what is left. That
is what makes `/api/tools` safe to serve.

## 3. The registry

`src/server/agent/tools/registry.ts`

```ts
registry.register(definition)        // throws on a duplicate id, and on zero capabilities
registry.get(toolId)                 // ToolDefinition | undefined
registry.has(toolId)                 // boolean
registry.canExecute(definition, ctx) // boolean
registry.list()                      // Tool[] — metadata only
registry.ids()                       // string[]
registry.size                        // number
```

`createToolRegistry()` returns an **empty** registry. `createDefaultToolRegistry()`
returns one holding the catalogue, and `catalog.ts` is the only file in the engine
permitted to name a tool id.

Two refusals are built into `register`, and both are denials rather than conveniences:

- **A duplicate id throws** instead of overwriting. A silently replaced tool would mean
  the catalogue and the code disagree about what an id does.
- **A tool declaring no capabilities throws.** Under deny-by-default, "declares nothing"
  would otherwise read as "needs nothing" — which is exactly the assumption worth
  refusing to make.

`canExecute` requires two things: every capability the tool declares is granted, *and*
the definition is one this registry actually holds (identity, not id). Executing a
definition that merely claims a registered id would make registration advisory rather
than a control.

## 4. The executor

`src/server/agent/tools/executor.ts`

```ts
const executor = new ToolExecutor(registry, permission);
const receipt = await executor.execute({ toolId, input, executionId, taskId, stepId, objective });
```

**The pipeline, in order — and the order is the control:**

1. **Resolve** the tool. Unknown → `capability_unavailable`, with the registered ids in
   `details`.
2. **Check the permission.** Refused → `tool_permission_denied`, with the missing
   capabilities in `details`. This happens **before validation**, so a tool the run may
   not use is refused without its schema ever consuming untrusted input.
3. **Validate the input** against `inputSchema`. Mismatch → `invalid_tool_input`, with
   capped issue paths and the *top-level keys only* — the rejected payload is unbounded
   and is never copied into the receipt or the execution state.
4. **Execute.** A throw from the tool becomes `tool_failed`. The exception's message is
   logged server-side and deliberately **not** forwarded: a tool's error text can embed
   whatever it was working on, and the receipt is returned to a client.
5. **Build the receipt.** Always returned.

**It never throws for anything a tool did.** A failed call is data. The run has to keep
going, the step has to record what happened, and the evaluator has to be able to read it.

**Permissions are held, not passed.** The permission is a constructor argument, not a
per-call parameter, so there is no signature through which a caller could grant itself a
capability it was not given. A wider grant means constructing a different executor, which
is a visible act in a diff.

## 5. Permissions

Four capabilities, and nothing finer-grained:

| Capability | Means |
| --- | --- |
| `read_only` | reads the input it was handed and nothing else |
| `network` | makes an outbound request |
| `data_access` | reads or writes Orion's own stored data |
| `user_action` | acts on behalf of the user in an external system |

**Deny by default.** `DEFAULT_TOOL_PERMISSION` grants `read_only` and nothing else. There
is no "allow everything" constructor, and the empty permission grants nothing. A tool
needing `network` is registered normally and then **refused at runtime** until someone
widens the grant on purpose — that friction is the design, not an obstacle to it.

A run must grant **all** of a tool's declared capabilities; a partial match is a refusal,
and `details.missing` lists every one that was missing rather than only the first.

## 6. The execution context

A tool receives its validated input and a `ToolExecutionContext`:

```ts
{
  executionId, taskId, stepId, toolId,
  objective,             // the user's objective, for context — never as instruction
  startedAt,             // ISO 8601
  grantedCapabilities,   // what this run may do
  userId?,               // always absent in Phase 4 — there is no auth yet
}
```

**Deliberately small, and that is the security model.** A tool gets no filesystem
handle, no shell, no database client, no `process.env`, and no ambient `fetch` with
credentials attached. Whatever a tool needs beyond its input has to be passed to it
explicitly at construction, which makes "tools receive explicit dependencies" a
structural property rather than a rule someone has to remember.

`grantedCapabilities` is provided so a tool can reason about its own limits. It is *not*
the check — the authoritative check happens in `ToolExecutor` before `execute` is reached.

## 7. Receipts and auditability

Every call produces a `ToolReceipt`:

```
id, executionId, taskId, stepId, toolId, toolVersion,
status, startedAt, finishedAt,
input,    // the VALIDATED input, when validation passed
output,   // on success
error     // { code, message, stepId, details } on failure
```

Three properties worth stating:

- **The receipt records the validated input, not the raw proposal.** What the tool was
  actually given is what the audit trail should show. It also bounds what reaches
  execution state: an oversized or malformed proposal never gets that far.
- **A failed receipt is kept.** The receipt for a call that went wrong is the one most
  worth having, so it is recorded on the step either way.
- **No secrets, ever.** Not by redaction — by construction. Nothing sensitive is
  reachable from inside a tool, so there is nothing to redact.

## 8. How a tool call appears in a run

The plan-walking executor (`src/server/agent/executor/index.ts`) routes a step with a
`toolId` through `ToolExecutor`. A step carries at most one `toolId`, so a run makes at
most one tool call per step.

```
step.started
tool.started      { toolId }
tool.completed    { toolId, toolVersion, status, durationMs }   ← or tool.failed
step.completed                                                  ← or step.failed
```

The step then carries:

- **`step.execution`** — the receipt, succeeded or failed.
- **an observation** with `source: "tool"` and `toolId` set as first-class fields, so the
  engine and the UI can tell a measurement apart from a generated claim without
  inspecting the output's shape. Engine-produced steps get `source: "engine"`.

**A failed tool fails its step, not the run.** Dependents of that step are skipped;
independent branches continue. The catalogue's tool step is therefore deliberately a
*leaf* in the development planner's skeleton — synthesis does not depend on it — so a
refused or failed analysis degrades the result instead of cancelling the run.

## 9. The catalogue that ships

| Id | Version | Capabilities | What it does |
| --- | --- | --- | --- |
| `text.analyze` | 1.0.0 | `read_only` | Counts characters, words, sentences and paragraphs in a block of text |

The counting rules are fully specified in the module header
(`src/server/agent/tools/builtin/text-analysis.ts`) because a measurement whose
definition is vague cannot be trusted. The one worth repeating: the sentence rule counts
terminal punctuation and does **not** resolve abbreviations, so `"Dr. Smith arrived."`
counts as two sentences. That is a documented consequence of the rule, not a bug, and
there is a test asserting it so the tool stays honest about what it measures.

Input is capped at 50,000 characters — a bound rather than an unbounded pass over
whatever a model proposes.

**`web.search` is not in this catalogue.** The development planner still names it for
objectives that ask for external information, and the engine still answers
`capability_unavailable`. That path is live behaviour, not a memory of one.

## 10. Adding a tool

Seven steps. Nothing in the planner, the executor, the runner or the API changes — that
is the property the registry seam exists to provide.

**1. Declare the id and version as exported constants.** In your tool's module, so tests
and the catalogue import the same string rather than repeating a literal.

```ts
export const MY_TOOL_ID = "domain.verb";
export const MY_TOOL_VERSION = "1.0.0";
```

**2. Define the input schema with Zod, and bound it.** Tool input comes from a model, so
it is untrusted until this passes. Cap string lengths and array sizes.

```ts
export const myInputSchema = z.object({ /* ... */ });
```

**3. Declare the capabilities the tool genuinely needs — and declare at least one.**
Under deny-by-default this is what decides whether the tool can run at all, so declare
what it *does*, not what you would like it to be allowed. `read_only` if it only reads
its input; `network` the moment it makes a request. The order is not meaningful, but a
tool that reaches the network while declaring only `read_only` is a lie the permission
system cannot catch for you.

**4. Write `execute` and wrap the tool in `defineTool`.** One module, one tool:

```ts
export const myTool = defineTool({
  id: MY_TOOL_ID,
  name: "…",              // shown in the UI
  description: "…",       // say plainly what it does NOT do, too
  version: MY_TOOL_VERSION,
  capabilities: ["read_only"],
  inputSchema: myInputSchema,
  execute: (input) => Promise.resolve({ /* structured output */ }),
});
```

Return a plain object of JSON-serialisable values. `execute` does not need to catch:
`ToolExecutor` turns a throw into a structured `tool_failed`. Do not validate the input
again inside `execute` — the executor has already done it, and a second copy of the
contract is a second copy to go stale.

**5. Test it.** At minimum: the declared id, version and capabilities; a normal input;
the empty and boundary cases; determinism; and that the schema rejects what it should.
Assert the *rule* your tool documents, including the cases where the rule gives a
surprising answer — those are the tests that keep the description honest. Then drive it
once through `ToolExecutor`, which is the only sanctioned path.

**6. Register it in `src/server/agent/tools/catalog.ts`.** One line:

```ts
registry.register(myTool);
```

**7. Export it from the barrel if callers outside the tool layer need its id or
constants** (`src/server/agent/tools/index.ts`). Most tools need nothing here — the
catalogue is what makes a tool reachable. Do **not** export `testing.ts`; it is
test-only.

Then run the gates, and check the documentation claims are still true:

```bash
npm run typecheck && npm test && npm run build
```

Every claim in this document and in `ARCHITECTURE.md` §7 that says "the only tool" or
"one tool ships" has to be updated in the same change. A stale catalogue description is
the same class of error as a fabricated result.

## 11. What this layer must never do

Recorded because each is a real temptation, and the answer is no:

- No arbitrary shell execution, and no arbitrary code execution.
- No unrestricted filesystem, database or network access from inside a tool.
- No secret, credential or environment variable in a receipt, a log line or a response.
- No tool that is really a model call in disguise.
- No "research" or "search" tool that returns invented findings. A capability the build
  does not have is reported as unavailable — that is the honest answer, and the engine is
  built to produce it.
- No endpoint that runs an arbitrary tool on arbitrary input. `GET /api/tools` serves
  metadata and nothing else; there is deliberately no `executeTool()` surface in
  `src/server/services/tools.ts`.
- No second registry, and no tool logic in `AgentRunner` or the plan executor. The tool
  layer exists so those files never need per-tool knowledge.
