import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, GitBranch, Layers, ShieldCheck, Terminal } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import {
  StatusIndicator,
  type StatusTone,
} from "@/components/common/status-indicator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "What Orion is, how a run actually works, what has been verified, and what it deliberately does not do.",
};

/*
  This page exists to be read instead of a live demo.

  That is the constraint it is written under, and it changes what belongs on it.
  A demo shows the thing working and the audience infers the rest; a page has to
  state the rest, including the parts a demo would have skipped past. So the
  section that matters most here is not "how it works" but *What is real and
  what is not* — because the project's own rule (recorded in
  `docs/DEVELOPMENT_PHASES.md` → Gates) is that "not implemented" is an
  acceptable state to be in and an inaccurate description of the current state
  is not. A reader who leaves this page believing retrieval works live has been
  misled by this page, not by the code.

  It is a static Server Component: it reads no request, no environment and no
  store, so it prerenders. The *live* configuration — which provider actually
  resolved in the running process — is deliberately not reported here, because a
  static render cannot know it; `/settings` reports that, and sets
  `force-dynamic` to do it honestly.
*/

const GITHUB_USER = "Ayeni2002";
const GITHUB_PROFILE = `https://github.com/${GITHUB_USER}`;
const GITHUB_REPO = `https://github.com/${GITHUB_USER}/Orion-agent`;
const GITHUB_BLOB = `${GITHUB_REPO}/blob/main`;

/**
 * The nine route handlers the build serves, as (method, path, what it returns).
 *
 * Listed rather than described because the surface is small enough to enumerate
 * and a reader checking a claim against the running server needs the exact
 * paths.
 */
const API_ROUTES: readonly {
  methods: string;
  path: string;
  detail: string;
}[] = [
  {
    methods: "GET",
    path: "/api/health",
    detail: "Liveness. The API convention in miniature — the thinnest endpoint.",
  },
  {
    methods: "POST, GET",
    path: "/api/agent/executions",
    detail:
      "Starts a run and returns it finished, or lists recent runs. A run completes inside this request.",
  },
  {
    methods: "GET",
    path: "/api/agent/executions/[id]",
    detail: "Reads one execution back. Returns 404 after a restart — see persistence below.",
  },
  {
    methods: "GET",
    path: "/api/agent/capabilities",
    detail: "What the engine can do before a run is attempted.",
  },
  {
    methods: "GET",
    path: "/api/tools",
    detail:
      "The registered tool catalogue, metadata only. Deliberately excludes research.search, so an agent run cannot reach the network.",
  },
  {
    methods: "POST, GET",
    path: "/api/research",
    detail:
      "Runs a research question and returns a terminal record, or lists summaries. A run that found too little is a 201, not a 500.",
  },
  {
    methods: "GET",
    path: "/api/research/capabilities",
    detail: "Whether retrieval is configured in this process.",
  },
  {
    methods: "POST, GET",
    path: "/api/reports",
    detail:
      "Generates a report for a research record, or returns the one already made for it; the GET lists summaries newest-first.",
  },
  {
    methods: "GET",
    path: "/api/reports/[id]",
    detail:
      "One report document. GET and nothing else — a report is written once and never afterwards, and a test asserts the write handlers are absent.",
  },
];

/**
 * The honest capability ledger — the reason this page exists.
 *
 * `tone` and `state` are kept apart so the colour never carries the meaning on
 * its own: `StatusIndicator` renders a labelled dot, and the label is what a
 * reader (or a printed page) actually reads.
 */
const CAPABILITY_ROWS: readonly {
  area: string;
  tone: StatusTone;
  state: string;
  detail: string;
}[] = [
  {
    area: "Agent engine",
    tone: "success",
    state: "Real",
    detail:
      "An objective is planned, the plan is validated against a schema and a dependency graph, executed in dependency order, evaluated deterministically, and returned as a structured result. The runner never throws — a failed run comes back as status failed with structured errors attached.",
  },
  {
    area: "Tool system",
    tone: "success",
    state: "Real",
    detail:
      "Every tool call goes through one executor: resolve, check permission before validating input, validate, execute, return a receipt. It always returns a receipt, including when the call failed. Deny by default — a run is granted read_only and nothing else.",
  },
  {
    area: "Reports",
    tone: "success",
    state: "Real, without a model",
    detail:
      "The document always builds. The evidence-bearing half — objective, findings, sources, evidence, conflicts, unresolved questions — is assembled by the server from the research record. Prose needs a model; without one the same report is built minus the prose, and the two cannot disagree about what the research found.",
  },
  {
    area: "Research layer",
    tone: "warning",
    state: "Built, one route unverified live",
    detail:
      "Planner, search tool, normaliser, finding extractor, evaluator and API are all built and tested against a stubbed transport. Two retrieval adapters exist: OpenRouter's web plugin, and Gemini's Google Search grounding. What no test establishes is that a given account and model honour either one — a test that reached the real endpoint would fail on a plane, in CI, and the day a key rotates. The OpenRouter route carries the passage each source is cited for; the Gemini route carries the page, not its text, so its findings report that they could not quote their sources.",
  },
  {
    area: "Web retrieval, by default",
    tone: "idle",
    state: "Not configured",
    detail:
      "The default model adapter performs no inference and contacts nothing. Retrieval turns on two ways: LLM_ENDPOINT pointing at openrouter.ai, where the web plugin is a property of the host; or LLM_API_STYLE=gemini, where grounding is part of the endpoint and the credential and is therefore settled by the style alone. Every other OpenAI-compatible endpoint resolves to the development adapter and a run stops at search_not_configured before planning, rather than appearing to search.",
  },
  {
    area: "Persistence",
    tone: "idle",
    state: "Not built",
    detail:
      "There is no database and no schema. Executions, research records and reports live in bounded process-local maps, so they do not survive a restart and are not shared between instances. A read after a restart returns 404 rather than reconstructing an answer.",
  },
  {
    area: "Authentication and ownership",
    tone: "idle",
    state: "Not built",
    detail:
      "The Supabase clients and their import conventions exist; no tables, migrations, policies or auth flow do. The research and report endpoints are unauthenticated and enforce no ownership, and the application does not pretend otherwise. When authentication lands, report ownership is the first thing that must be added.",
  },
  {
    area: "Long-term memory",
    tone: "idle",
    state: "Not built",
    detail:
      "No memory, no vector store, no embeddings, and no cross-run cache of retrieved sources. A research run's sources are available only from its own record. Task state is not memory.",
  },
  {
    area: "URL fetching",
    tone: "idle",
    state: "Not built",
    detail:
      "Orion records a source's URL and never dereferences it. There is no fetcher to abuse. The vetting in research/url-safety.ts — schemes, credentials, internal destinations — is written as though there were one.",
  },
  {
    area: "Background execution",
    tone: "idle",
    state: "Not built",
    detail:
      "No scheduler, no queue, no workers, no multi-agent collaboration, no cancel endpoint. A run completes inside the request that started it.",
  },
  {
    area: "Export and delivery",
    tone: "idle",
    state: "Not built",
    detail:
      "A report prints through the browser's own print dialog, with chrome hidden and the palette flattened to black on white. There is no PDF generation, no PDF dependency, no file format, no email and no scheduling.",
  },
];

/**
 * The phase ledger, transcribed from `docs/DEVELOPMENT_PHASES.md`.
 *
 * The numbering is not sequential because the work diverged from the original
 * roadmap four times, and that document records each divergence rather than
 * renumbering quietly. It is reproduced here because the divergence is part of
 * the project's story.
 */
const PHASES: readonly {
  phase: string;
  name: string;
  status: string;
  tone: StatusTone;
  detail: string;
}[] = [
  {
    phase: "1",
    name: "Foundation",
    status: "Complete",
    tone: "success",
    detail:
      "Next.js App Router + TypeScript, Tailwind, the application shell and route boundaries, environment strategy read in one place, Supabase connectivity, domain vocabulary, and the route-handler-over-service convention.",
  },
  {
    phase: "2",
    name: "Application shell",
    status: "Complete",
    tone: "success",
    detail:
      "Every surface the product needs, navigable, with nothing faked behind it. The rule this phase set and later phases must not break: no fabricated data anywhere.",
  },
  {
    phase: "3",
    name: "Agent engine",
    status: "Complete",
    tone: "success",
    detail:
      "The ModelProvider abstraction, the planner, the executor, the evaluator, the runtime with its append-only event log and state builder, and the executions API driving the workspace.",
  },
  {
    phase: "4",
    name: "Tool system",
    status: "Complete",
    tone: "success",
    detail:
      "Registry, executor, execution context, deny-by-default permissions, receipts, and the first real tool — text.analyze. Phase 3's tool seam was replaced rather than filled, and the old registry deleted.",
  },
  {
    phase: "5",
    name: "Research intelligence",
    status: "Complete",
    tone: "success",
    detail:
      "A question is planned into retrieval tasks, searched, normalised, deduplicated, read for findings, evaluated, and returned as a record in which every claim resting on a source carries the passage it rests on.",
  },
  {
    phase: "6",
    name: "Reports & deliverables",
    status: "Complete",
    tone: "success",
    detail:
      "A finished research result becomes a document a person can read, print and check. Roadmapped as Phase 8; built here because a report resting on verified quotes is traceable by construction and needs no provider at all.",
  },
  {
    phase: "5R",
    name: "Database & persistence",
    status: "Not started",
    tone: "idle",
    detail:
      "The original Phase 5, displaced rather than cancelled and unchanged. It now has more to replace than when it was written — three process-local stores rather than one.",
  },
  {
    phase: "6R",
    name: "Real model provider",
    status: "Partly delivered",
    tone: "warning",
    detail:
      "Two adapters reach a real provider: an OpenAI-compatible one selected by LLM_API_STYLE=openai, covering OpenRouter, Groq, Together, vLLM, LM Studio and OpenAI itself; and a native Gemini one speaking generateContent, which is what makes Google Search grounding reachable at all — the compatibility endpoint does not expose it. What remains is confirming either retrieval route against a live account.",
  },
  {
    phase: "7",
    name: "Memory & state",
    status: "Not started",
    tone: "idle",
    detail:
      "Long-term memory distinct from task state, retrieval at planning time, and writes at the end of a run — persisted in PostgreSQL so memory survives a restart.",
  },
  {
    phase: "8",
    name: "Reports & delivery",
    status: "Partly delivered",
    tone: "warning",
    detail:
      "Generation, presentation and traceability were built as Phase 6. What this phase still owns is delivery and export, plus the persisted runs and memory the original ordering assumed would exist by now.",
  },
  {
    phase: "9",
    name: "Hardening & deployment",
    status: "Not started",
    tone: "idle",
    detail:
      "CI on every push, per-environment configuration, rate limiting and cost ceilings, observability over model and tool calls, and the security review a system holding credentials and executing tools requires.",
  },
];

/**
 * The pipeline, as the engine actually orders it.
 *
 * Rendered as a wrapping row of stages rather than a diagram: it is a linear
 * sequence with one loop inside it, and a picture would add nothing a list of
 * arrows does not already say.
 */
const PIPELINE_STAGES = [
  "request",
  "validate",
  "plan",
  "execute",
  "tool call",
  "observe",
  "evaluate",
  "result",
] as const;

/** Inline code, styled once so a long page of identifiers reads consistently. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground">
      {children}
    </code>
  );
}

/** A block of output or commands. `label` names what produced it. */
function CodeBlock({ label, children }: { label?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {label ? (
        <div className="border-b border-border bg-muted px-4 py-2 font-mono text-xs text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="overflow-x-auto bg-muted/40">
        <pre className="px-4 py-3 font-mono text-xs leading-relaxed">
          <code>{children}</code>
        </pre>
      </div>
    </div>
  );
}

/** An anchor that leaves the application, marked as external for a screen reader. */
function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** One section of the page, with the heading level and spacing applied once. */
function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {lede ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{lede}</p>
        ) : null}
      </div>

      {children}
    </section>
  );
}

/** A key/value pair, for the environment and stack tables. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const TOC = [
  { href: "#what", label: "What Orion is" },
  { href: "#run", label: "How a run works" },
  { href: "#layers", label: "The layers" },
  { href: "#rules", label: "The rules it will not break" },
  { href: "#real", label: "What is real and what is not" },
  { href: "#verified", label: "How it is verified" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#local", label: "Running it locally" },
  { href: "#read", label: "Where to read more" },
] as const;

export default function DocsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        title="Documentation"
        description="Orion is an autonomous research agent: it takes an objective, plans the work, calls tools, checks its own results, and returns a document whose claims carry the evidence behind them. This page is the whole of it — including the parts that are not finished."
        actions={
          <>
            <Button asChild variant="default" size="sm">
              <a href={GITHUB_REPO} target="_blank" rel="noreferrer noopener">
                <GitBranch aria-hidden />
                View the repository
              </a>
            </Button>

            <Button asChild variant="outline" size="sm">
              <a href={GITHUB_PROFILE} target="_blank" rel="noreferrer noopener">
                {GITHUB_USER} on GitHub
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
          </>
        }
      />

      {/* The ledger is the first thing on the page, not the last. A reader who
          stops after one screen should stop knowing what is not built. */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="text-sm">
          <strong className="font-semibold">Read this first.</strong> Orion is
          honest about its own state by design, and this page keeps that
          promise: reach for{" "}
          <a href="#real" className="font-medium text-primary underline-offset-4 hover:underline">
            What is real and what is not
          </a>{" "}
          before assuming any feature works. There is no database, no
          authentication and no live retrieval configured out of the box — the
          agent engine, the tool system and report generation are real and run
          end to end.
        </p>
      </div>

      {/* On this page */}
      <nav aria-label="On this page">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">On this page</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {TOC.map((entry) => (
                <li key={entry.href}>
                  <a
                    href={entry.href}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {entry.label}
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </nav>

      <Section
        id="what"
        title="What Orion is"
        lede="A research agent built to be checkable rather than impressive. Every design decision below follows from one constraint: nothing may be claimed that was not retrieved."
      >
        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            Orion turns a goal into a structured, researched, actionable result.
            The workflow — understand an objective, plan the work, select tools,
            execute, observe, evaluate, revise — is real, and so is the research
            layer above it: a question is planned into retrieval tasks, searched,
            deduplicated, read for findings, and returned with the evidence
            behind every claim that has any.
          </p>

          <p>
            The organising idea is that{" "}
            <strong className="font-medium text-foreground">
              a finding is a claim plus a quote
            </strong>
            . Prose cannot enforce traceability, so every attributed claim
            carries the passage it rests on and that passage is checked against
            the retrieved text. A quote that does not verify does not get
            discarded and does not get accepted — it{" "}
            <em>demotes</em> the claim to{" "}
            <Code>basis: &quot;model&quot;</Code>. The claim is kept and
            labelled, which is more useful than losing it and more honest than
            pretending it was sourced.
          </p>

          <p>
            The same discipline runs through the report layer. The
            evidence-bearing half of a report is built by the server and is
            never model-authored; a model writes only prose, and every prose
            block declares which findings it draws on. A reader can therefore
            answer <em>where did Orion get this?</em> without searching the
            application.
          </p>

          <p>
            The model provider is{" "}
            <strong className="font-medium text-foreground">
              configuration, not a dependency
            </strong>
            . No provider SDK is installed and no vendor is named in the engine.
            The engine talks to a <Code>ModelProvider</Code> interface, and the
            default implementation is a deterministic adapter that performs no
            inference and contacts nothing — because the default must be a
            configuration that works with no credentials at all.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Fact term="Framework">
                Next.js 16 (App Router) and React 19, TypeScript throughout
              </Fact>
              <Fact term="Styling">Tailwind CSS v4 with shadcn/ui-style primitives</Fact>
              <Fact term="Validation">Zod schemas at every untrusted boundary</Fact>
              <Fact term="Testing">Vitest, node environment, no network or credentials needed</Fact>
              <Fact term="Model provider">
                Interface plus three adapters — development, OpenAI-compatible
                and Gemini — and a scripted test stub; no SDK
              </Fact>
              <Fact term="Database">
                Supabase clients installed; no schema, no tables, no migrations
              </Fact>
            </dl>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="run"
        title="How a run works"
        lede="One lifecycle, assembled in one place, and it never throws. A failed run is data, not an exception."
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The agent lifecycle</CardTitle>
            <CardDescription>
              Assembled in <Code>src/server/agent/runtime/runner.ts</Code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
              {PIPELINE_STAGES.map((stage, index) => (
                <li key={stage} className="flex items-center gap-2">
                  <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs">
                    {stage}
                  </span>
                  {index < PIPELINE_STAGES.length - 1 ? (
                    <span aria-hidden className="text-muted-foreground">
                      &rarr;
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>

            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">The runner never throws.</strong>{" "}
                A failed run comes back as an execution with{" "}
                <Code>status: &quot;failed&quot;</Code> and structured errors
                attached, so the caller always gets a document to render.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  One failed step does not abort the run.
                </strong>{" "}
                Dependent steps are skipped and independent branches continue. A
                failed tool call fails its step for the same reason, and is
                recorded as a receipt either way.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  The model produces a plan; the engine decides what to call.
                </strong>{" "}
                A plan is Zod-validated and then checked for dependency cycles,
                so no malformed model output can enter the execution system. The
                model never executes a tool.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  The verdict is computed, not narrated.
                </strong>{" "}
                The evaluator decides the outcome from the recorded step
                outcomes alone and asks the provider only for the narrative
                sentence.
              </li>
            </ul>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">The research run</CardTitle>
              <CardDescription>
                A layer on the engine, not a second one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Planning goes through the Phase 3{" "}
                <Code>ModelProvider</Code>, retrieval through the Phase 4{" "}
                <Code>ToolExecutor</Code>, progress through the{" "}
                <Code>EventLog</Code> and <Code>ExecutionStateBuilder</Code>, and
                failures through <Code>AgentExecutionError</Code>. The import
                list is the design.
              </p>
              <ul className="space-y-2">
                <li>
                  <Code>research.search</Code> is the only tool in Orion that
                  declares <Code>network</Code>. It vets every returned URL,
                  re-derives the domain from the vetted URL, canonicalises,
                  clamps the result count, and counts refusals separately from
                  drops.
                </li>
                <li>
                  It is registered in a per-run registry and never in the
                  default catalogue, because the default is what{" "}
                  <Code>/api/tools</Code> reports and what every agent run
                  resolves against.
                </li>
                <li>
                  Five environment ceilings bound the loops — tasks, sources per
                  task, total sources, findings, and a duration ceiling — each
                  checked before the work it bounds, each recorded when reached,
                  with the partial result returned rather than discarded. A
                  malformed limit throws rather than silently defaulting.
                </li>
                <li>
                  Conflicts are <em>recorded, never resolved</em>: the findings
                  that disagree, the sources they span, and a description.
                  Nothing decides which side is right.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">The report</CardTitle>
              <CardDescription>
                One idea, and the rest reduces to it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                The evidence-bearing half is server-authored and never
                model-authored. The title, objective, findings, sources,
                evidence, conflicts and unresolved questions are assembled from
                the research record verbatim. Only the executive summary, the
                detailed analysis and the suggested next steps are prose.
              </p>
              <p>
                Grounding is arithmetic rather than instruction: no field
                accepts a URL from the model, every citation index must resolve
                to a finding or it is dropped and counted, quotes come only from
                evidence the research layer already verified, and every numeric
                token in generated prose must appear in the brief the model was
                shown or the sentence is flagged and counted.
              </p>
              <p>
                Because the evidence half is always server-authored, a report
                with a model and one without cannot disagree about what the
                research found. Failure is never silent: the model output is
                rejected and the deterministic report stands, or a claim is
                degraded and counted, or the report fails at the service
                boundary with an honest status.
              </p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        id="layers"
        title="The layers"
        lede="Four layers, each built against a seam rather than against an implementation — which is why the engine could be built and tested before anything real sat behind it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {[
            {
              title: "Agent engine",
              path: "src/server/agent/",
              parts:
                "provider — the ModelProvider interface and its adapters; planner — objective to validated plan; executor — walks the plan and records observations; tools — the tool system; evaluator — the deterministic verdict; runtime — state builder, append-only event log, process-local store, the runner.",
            },
            {
              title: "Tool system",
              path: "src/server/agent/tools/",
              parts:
                "definition.ts — the tool contract; registry.ts — register, get, has, list, canExecute; executor.ts — the only sanctioned way to call a tool; catalog.ts — the one file that decides which tools a run can call; builtin/ — the tools that ship.",
            },
            {
              title: "Research layer",
              path: "src/server/research/",
              parts:
                "provider — the ResearchProvider interface, the OpenRouter web-search adapter, the Gemini grounding adapter, the development adapter; planner; tools — research.search; findings — source text to claims; evaluator; normalize.ts — canonicalisation and deduplication; url-safety.ts; permission.ts — the one widened grant, in its own file so it is findable; service.ts — the run loop.",
            },
            {
              title: "Report layer",
              path: "src/server/report/",
              parts:
                "generator, deterministic builder, grounding — the whole of the arithmetic machine, with its functions exported so a test can assert the arithmetic rather than the generator; schema; service; store. The renderer lives separately in components/reports/ and knows nothing about how a report was produced.",
            },
          ].map((layer) => (
            <Card key={layer.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers aria-hidden className="size-4 text-muted-foreground" />
                  {layer.title}
                </CardTitle>
                <CardDescription>
                  <code className="font-mono text-xs">{layer.path}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {layer.parts}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The API surface</CardTitle>
            <CardDescription>
              Nine route handlers. Thin by convention: they parse and validate
              the request, call a service, and shape the response. No business
              logic, no direct database calls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {API_ROUTES.map((route) => (
                <li
                  key={route.path}
                  className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-32">
                    {route.methods}
                  </span>
                  <span className="shrink-0 font-mono text-xs sm:w-64">
                    {route.path}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {route.detail}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="rules"
        title="The rules it will not break"
        lede="These are enforced in code, not by convention. They exist because a plausible-looking answer is the failure mode of this kind of system, and the defence has to be structural."
      >
        <ul className="space-y-4">
          {[
            {
              title: "The client cannot assert that work was done.",
              body: "No endpoint accepts a status, a step list, a finding, a source or a result. A run's status is computed by the evaluator from what the steps actually did, unknown keys in a request body are stripped before the engine sees them, and a research request is reduced to { question } — so a client cannot manufacture evidence.",
            },
            {
              title: "Deny by default.",
              body: "A run is created granting read_only and nothing else. Permission is a constructor argument to the executor rather than a per-call parameter, it is checked before input validation so a refused tool never consumes untrusted input, and widening it means editing a file that exists only to be findable.",
            },
            {
              title: "A tool is handed nothing ambient.",
              body: "A tool receives its validated input and a small execution context — ids, objective, start time, granted capabilities. No filesystem, shell, environment, database or network handle. Its dependencies must be passed to it explicitly, so no secret is reachable from inside a tool and none can appear in a receipt.",
            },
            {
              title: "A failure is data, not an exception.",
              body: "The tool executor always returns a receipt, including when the call failed. The runner never throws. Unknown tool, refused permission, invalid input and a throwing tool each become a structured error code the UI can render honestly.",
            },
            {
              title: "No fabricated data anywhere.",
              body: "The rule Phase 2 set and every later phase has kept. Every list is an explicitly empty typed constant rendered through an empty state. No invented statistics, no simulated progress, no placeholder results, and no step shown that the engine did not take.",
            },
            {
              title: "A control belonging to a later phase is not rendered.",
              body: "Amended from the original rule that such controls are disabled. Three have been removed on this basis, because the honest label repeated across three pages still reads as three broken features — and a broken feature is indistinguishable from a bug. One disabled control remains, on the research page, because it reflects a configured state that can change and an alert above it names the boundary.",
            },
          ].map((rule) => (
            <li key={rule.title} className="flex gap-3">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">{rule.title}</p>
                <p className="text-sm text-muted-foreground">{rule.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="real"
        title="What is real and what is not"
        lede="The most useful section on this page. Every row is a statement about this build, not about the roadmap's intent."
      >
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {CAPABILITY_ROWS.map((row) => (
            <li key={row.area} className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{row.area}</span>
                <StatusIndicator tone={row.tone} label={row.state} />
              </div>
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {row.detail}
              </p>
            </li>
          ))}
        </ul>

        <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <Terminal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            The workspace and research forms are not simulations. The{" "}
            <strong className="font-medium text-foreground">Start Agent</strong>{" "}
            button runs the real engine and renders what it returns, and the
            research form posts to the real endpoint and renders the record that
            comes back. Neither invents progress, and neither shows a step the
            engine did not take. What varies is which provider is configured —
            and every result says which one produced it.
          </p>
        </div>
      </Section>

      <Section
        id="verified"
        title="How it is verified"
        lede="Every phase ends the same way, and a phase is not complete until all three gates pass locally."
      >
        <CodeBlock label="the gate">{`npm run typecheck && npm test && npm run build`}</CodeBlock>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The rules around those gates matter as much as the gates: TypeScript
            configuration is never weakened and tests are never disabled to make
            a gate pass — a gate that was weakened is worse than a gate that
            failed. Tests never depend on live credentials or network access, so
            the suite behaves identically in CI, on a fresh checkout, and on a
            machine that has a provider key exported in its shell.
          </p>

          <p>
            The engine is tested at two levels. Units cover plan validation, the
            development adapter&rsquo;s determinism, the tool registry, the
            executor&rsquo;s pipeline, the text-analysis rules, error conversion
            and the store&rsquo;s bound. Integration drives the whole lifecycle
            against a <em>scripted</em> provider: cancellation, a failing step,
            an unavailable capability, a tool-backed step end to end, a failed
            tool, a refused permission, rejected tool input, planner failure and
            provider misconfiguration. The research and report layers are tested
            the same way, against scripted providers, with every remote call
            stubbed at <Code>fetch</Code>.
          </p>
        </div>

        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">
              What the tests do not establish
            </CardTitle>
            <CardDescription>
              Stated plainly, because a green suite is easy to over-read.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="space-y-2">
              <li>
                <strong className="font-medium text-foreground">
                  There is no component-render or end-to-end browser layer.
                </strong>{" "}
                CSS, layout and client interactivity are unverified by tests.
                Every presentation rule that can be decided without rendering
                was extracted into a tested module, and that a component draws
                what the rule says is covered by nothing.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  No test reaches a live service.
                </strong>{" "}
                Every model and retrieval call is scripted, so what is
                established is that a response is parsed, checked and rejected
                or degraded as specified — not that a given account and model
                behave as expected.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  The prose path has never been exercised against a live model.
                </strong>{" "}
                The design anticipates a model response being refused outright,
                and the report is still complete when it is.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  The recorded results live in the repository.
                </strong>{" "}
                Per-phase gate results, including counts and build output, are
                recorded in{" "}
                <ExternalLink href={`${GITHUB_BLOB}/docs/DEVELOPMENT_PHASES.md`}>
                  docs/DEVELOPMENT_PHASES.md
                </ExternalLink>{" "}
                rather than restated here, where they would go stale silently.
              </li>
            </ul>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="roadmap"
        title="Roadmap"
        lede="The numbering is not sequential, and that is recorded rather than tidied. The plan and the work diverged four times; each divergence is a finding about the original reasoning, not a correction to it."
      >
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {PHASES.map((phase) => (
            <li key={phase.phase} className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-muted-foreground">
                  Phase {phase.phase}
                </span>
                <span className="text-sm font-medium">{phase.name}</span>
                <StatusIndicator tone={phase.tone} label={phase.status} />
              </div>
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {phase.detail}
              </p>
            </li>
          ))}
        </ul>

        <p className="max-w-3xl text-sm text-muted-foreground">
          The original roadmap put the database first and reports last, on the
          reasoning that both need persisted memory and a live model. Building
          the engine third turned out to be possible because it was designed
          against seams rather than implementations, and building reports early
          turned out to be better <em>without</em> either — a report resting on
          already-verified quotes is traceable by construction rather than by
          retrieval, and generatable with no provider at all.
        </p>
      </Section>

      <Section
        id="local"
        title="Running it locally"
        lede="It renders and runs with nothing configured. That is the default configuration, not a degraded one."
      >
        <CodeBlock label="terminal">{`npm install
cp .env.example .env.local     # then fill in the values
npm run dev`}</CodeBlock>

        <p className="text-sm text-muted-foreground">
          The dev server runs on{" "}
          <code className="font-mono text-xs">http://localhost:3000</code>. Orion
          renders without Supabase configured; only the features that need a
          database report that it is missing. Requires Node 20.9 or later, which
          is Next.js 16&rsquo;s minimum.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
            <CardDescription>
              Every value is read in <Code>src/lib/env.ts</Code> and nowhere
              else. The model credential is read there and never returned — the
              accessor reports whether a key is present, never its value, so no
              code path can put it in a response body, an error message or a log
              line.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact term="LLM_API_STYLE">
                <Code>dev</Code> (default), <Code>openai</Code> or{" "}
                <Code>gemini</Code>. Any other style is rejected unless an
                adapter exists for it, because naming a style Orion cannot
                construct would turn a configuration mistake into a run that
                appears to use a real model and does not.
              </Fact>
              <Fact term="LLM_ENDPOINT">
                Base URL only, and the path suffix is the style&rsquo;s
                business. Optional for <Code>gemini</Code>, which has one
                canonical host; required for <Code>openai</Code>, which names a
                protocol many vendors speak.
              </Fact>
              <Fact term="LLM_MODEL">
                The endpoint&rsquo;s own model id. Required for every style but{" "}
                <Code>dev</Code> — a defaulted model id would fail later as a
                404 from the provider rather than here as a sentence naming the
                variable.
              </Fact>
              <Fact term="LLM_API_KEY">
                Optional — a local endpoint needs none. Sent as a header, never
                as a query parameter, because a query string is written to proxy
                logs, access logs and error messages.
              </Fact>
              <Fact term="RESEARCH_SEARCH_MODEL">
                Optionally names a cheaper model for fetching; defaults to{" "}
                <Code>LLM_MODEL</Code>. Means the same thing on both retrieval
                routes: a cheaper model fetching, a stronger one reasoning.
              </Fact>
              <Fact term="RESEARCH_MAX_*">
                Five ceilings: tasks (5), sources per task (5), total sources
                (20), findings (50) and duration in milliseconds (120000). Those
                are the defaults when unset.
              </Fact>
            </dl>

            <div className="rounded-md border border-border bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Turning retrieval on, end to end. There is no separate research
                credential, because retrieval is a model call with a search
                tool attached — the key that plans is the key that fetches:
              </p>
              <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
                <code>{`# OpenRouter — the route that returns cited passages
LLM_API_STYLE=openai
LLM_ENDPOINT=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o
LLM_API_KEY=<your key>`}</code>
              </pre>
              <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed">
                <code>{`# Gemini — grounding is on the style, so no endpoint is needed
LLM_API_STYLE=gemini
LLM_MODEL=gemini-2.5-flash
LLM_API_KEY=<your key>`}</code>
              </pre>
              <p className="mt-3 text-xs text-muted-foreground">
                The Gemini route is the thinner of the two, and the difference
                is worth knowing before choosing it. Grounding returns the pages
                a search found and not their text, so a source arrives with a
                URL and a title and no passage, and the findings built on it say
                they could not quote it. The alternative was refused on purpose:{" "}
                <code className="font-mono text-xs">
                  groundingSupports[].segment.text
                </code>{" "}
                is the model&rsquo;s own prose, and treating it as source text
                would make the verbatim-quote check pass against a sentence no
                page ever contained.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Which provider actually resolved in a running process is reported
              live on the{" "}
              <Link
                href="/settings"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Settings
              </Link>{" "}
              page, which reads the server&rsquo;s environment on every request.
              This page is static and deliberately does not guess.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section
        id="read"
        title="Where to read more"
        lede="The long-form documentation lives in the repository, beside the code it describes."
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            {
              file: "docs/ARCHITECTURE.md",
              what: "The shape of the system — frontend, backend, the database boundary, and the engine, model abstraction, tool system, memory and research layer.",
            },
            {
              file: "docs/RESEARCH.md",
              what: "The research layer in full — the run, the provider seam, the planner, findings and evidence, conflicts, the evaluator, limits, the API and the security review.",
            },
            {
              file: "docs/TOOL_SYSTEM.md",
              what: "The tool layer in full — vocabulary, registry, executor, permissions, receipts, and how to add a tool.",
            },
            {
              file: "docs/REPORTS.md",
              what: "The report layer — the domain model, the grounding contract, the deterministic fallback and the print view.",
            },
            {
              file: "docs/DEVELOPMENT_PHASES.md",
              what: "The phase roadmap, what each phase depends on, what is done, the gate results, and the rules that hold for every phase.",
            },
            {
              file: "README.md",
              what: "Setup, scripts, conventions, the environment reference, and the project's own not-implemented list.",
            },
          ].map((doc) => (
            <li key={doc.file}>
              <a
                href={`${GITHUB_BLOB}/${doc.file}`}
                target="_blank"
                rel="noreferrer noopener"
                className="flex h-full flex-col gap-1.5 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
                  {doc.file}
                  <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground" />
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {doc.what}
                </span>
              </a>
            </li>
          ))}
        </ul>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The repository</CardTitle>
            <CardDescription>
              Source, history and the full documentation set.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact term="Repository">
                <ExternalLink href={GITHUB_REPO}>
                  {GITHUB_USER}/Orion-agent
                </ExternalLink>
              </Fact>
              <Fact term="Author">
                <ExternalLink href={GITHUB_PROFILE}>{GITHUB_USER}</ExternalLink>
              </Fact>
            </dl>

            <p className="text-xs text-muted-foreground">
              The repository previously held a Python CLI DeFi scoring agent. It
              was replaced by this application in a later commit; the previous
              code remains recoverable in the history.
            </p>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
