"use client";

import { Activity, AlertTriangle, BookOpen, Link2, ListChecks, Quote } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import {
  StatusIndicator,
  type StatusTone,
} from "@/components/common/status-indicator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ResearchRecord, ResearchSufficiency } from "@/types/research";

import type {
  FindingBasis,
  ResearchEvidence,
  ResearchSource,
  ResearchStatus,
} from "@/types/research";

/**
 * The research record, rendered from what the backend actually returned.
 *
 * Every value on this panel comes from a `ResearchRecord` the service produced.
 * Nothing is inferred, animated or advanced locally, and there is no progress
 * bar: a research run finishes inside the request that starts it, so there are
 * no intermediate states for the server to report and inventing some would be
 * the one thing §19 rules out. While the request is in flight the panel says
 * exactly that — a run is in progress — and when it lands, everything here is
 * already final.
 *
 * **The chain is the point of the findings list.** §13 requires
 * Finding → Evidence → Source → URL, and this panel walks it in that order: a
 * finding shows its statement, then the verbatim passage that supports it, then
 * the domain and URL that passage came from. A reader can check any claim
 * against the text behind it without leaving the page, which is what makes the
 * difference between a finding that is *supported* and one that merely reads
 * well.
 *
 * **A finding that is not source-backed says so, prominently.** `basis` is
 * `"model"` when a claim could not be traced to text in the source it cited —
 * the model's own inference, kept and labelled rather than deleted. Rendering
 * that identically to a supported finding would overstate the result, so it gets
 * its own tone, its own label and no evidence quotes, because there are none.
 *
 * **Two providers are reported, not one.** A research run searches with one
 * adapter and reasons with another, and the panel names both. When either is the
 * deterministic development adapter the panel says so, for the same reason the
 * workspace does: a run produced without a model must not read as though a model
 * produced it.
 */

const STATUS_PRESENTATION: Record<
  ResearchStatus,
  { tone: StatusTone; label: string }
> = {
  created: { tone: "idle", label: "Created" },
  planning: { tone: "active", label: "Planning" },
  running: { tone: "active", label: "Searching" },
  evaluating: { tone: "active", label: "Evaluating" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "error", label: "Failed" },
  cancelled: { tone: "warning", label: "Cancelled" },
};

/**
 * The four verdicts, and what each one means.
 *
 * The descriptions are not decoration. `insufficient` is the one most likely to
 * be misread — it looks like a failure and is not — so the panel says in the
 * same breath that the run finished and simply did not find enough. `conflicting`
 * gets the same treatment: the sources disagree, and that is a result rather
 * than an error.
 */
const SUFFICIENCY_PRESENTATION: Record<
  ResearchSufficiency,
  { tone: StatusTone; label: string; description: string }
> = {
  sufficient: {
    tone: "success",
    label: "Question answered",
    description:
      "The retrieved sources settle the question, and each finding below traces to the passage it came from.",
  },
  insufficient: {
    tone: "warning",
    label: "Not enough found",
    description:
      "The run finished and the sources it retrieved do not settle the question. This is an honest result, not a failure — what was found is below.",
  },
  conflicting: {
    tone: "warning",
    label: "Sources disagree",
    description:
      "Sources were found and they contradict each other. Both sides are listed rather than one being chosen for you.",
  },
  failed: {
    tone: "error",
    label: "Could not be researched",
    description:
      "The run could not carry out the research at all. The reason is below.",
  },
};

const BASIS_PRESENTATION: Record<
  FindingBasis,
  { tone: StatusTone; label: string }
> = {
  source: { tone: "success", label: "From a source" },
  model: { tone: "warning", label: "Model inference" },
};

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * The activity log.
 *
 * The same `AgentEvent` list an agent run produces, rendered the same way: these
 * are the Phase 3 events, emitted by the Phase 3 `EventLog`, so the two panels
 * read alike because they are reading the same kind of thing rather than because
 * one was copied from the other.
 */
function ActivityLog({ record }: { record: ResearchRecord }) {
  if (record.events.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity"
        description="The run did not emit any events."
        className="py-8"
      />
    );
  }

  return (
    <ol className="space-y-2">
      {record.events.map((event) => (
        <li key={event.id} className="flex gap-3 text-xs">
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {formatTime(event.timestamp)}
          </span>
          <span className="min-w-0">
            <span className="font-mono text-muted-foreground">{event.type}</span>{" "}
            {event.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One evidence passage: the quote, and the URL it was retrieved from. */
function EvidenceBlock({ evidence }: { evidence: ResearchEvidence }) {
  return (
    <blockquote className="space-y-1 border-l-2 border-border pl-3">
      <div className="flex gap-2">
        <Quote aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <p className="text-xs italic text-muted-foreground">{evidence.quote}</p>
      </div>

      {/*
        The href was vetted before it reached the record: `parseSourceUrl`
        rejects anything that is not http/https and anything pointing at an
        internal host, so a `javascript:` URL cannot be stored as a source and
        therefore cannot be rendered as a link here. `noopener` and `noreferrer`
        are belt and braces on top of that.
      */}
      <a
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        <Link2 aria-hidden className="size-3" />
        {evidence.url}
      </a>
    </blockquote>
  );
}

export interface ResearchPanelProps {
  record: ResearchRecord | null;
  isSubmitting: boolean;
}

export function ResearchPanel({ record, isSubmitting }: ResearchPanelProps) {
  const result = record?.result;

  // Built once here rather than inside the render loop, so a list of fifty
  // findings does not rescan the evidence array fifty times to find its own.
  const evidenceByFinding = new Map<string, ResearchEvidence[]>();
  const sourceById = new Map<string, ResearchSource>();

  if (record !== null) {
    for (const source of record.sources) {
      sourceById.set(source.id, source);
    }

    for (const evidence of record.evidence) {
      const existing = evidenceByFinding.get(evidence.findingId);

      if (existing === undefined) {
        evidenceByFinding.set(evidence.findingId, [evidence]);
      } else {
        existing.push(evidence);
      }
    }
  }

  const citedSourceIds = new Set(record?.evidence.map((item) => item.sourceId) ?? []);
  const status = record === null ? null : STATUS_PRESENTATION[record.status];
  const sufficiency =
    result === undefined ? null : SUFFICIENCY_PRESENTATION[result.sufficiency];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-sm">Research</CardTitle>
            <CardDescription>Plan, sources and findings.</CardDescription>
          </div>

          <StatusIndicator
            tone={isSubmitting ? "active" : (status?.tone ?? "idle")}
            label={isSubmitting ? "Researching" : (status?.label ?? "Idle")}
          />
        </CardHeader>

        <CardContent className="space-y-4">
          {record === null ? (
            <EmptyState
              icon={ListChecks}
              title={isSubmitting ? "Researching…" : "Nothing researched yet"}
              description={
                isSubmitting
                  ? "Orion is breaking the question into retrieval tasks and searching for each one. The run finishes before the response returns, so the result appears all at once — there is no partial progress to show."
                  : "Ask a question and Orion's plan, sources and findings will appear here."
              }
            />
          ) : (
            <>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Research <code className="font-mono">{record.id}</code>
                </p>
                <p>
                  Retrieval{" "}
                  <code className="font-mono">
                    {record.provider.id}:{record.provider.model}
                  </code>
                </p>
                {record.modelProvider === undefined ? null : (
                  <p>
                    Reasoning{" "}
                    <code className="font-mono">
                      {record.modelProvider.id}:{record.modelProvider.model}
                    </code>
                  </p>
                )}
              </div>

              {record.provider.isExternal ? null : (
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {record.provider.label}. No external search ran — this run
                  retrieved nothing from the network, and its result says so
                  rather than presenting generated text as sourced evidence.
                </p>
              )}

              {record.modelProvider === undefined ||
              record.modelProvider.isExternal ? null : (
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {record.modelProvider.label}. The question was decomposed and
                  the sources read by a deterministic local adapter, not a
                  language model.
                </p>
              )}

              {record.plan === undefined ? null : (
                <div className="space-y-1">
                  <p className="text-xs font-medium">
                    Understood as
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {record.plan.restatement}
                  </p>
                </div>
              )}

              {result === undefined || sufficiency === null ? null : (
                <div className="space-y-2 rounded-md border border-border px-3 py-2">
                  <StatusIndicator
                    tone={sufficiency.tone}
                    label={sufficiency.label}
                  />
                  <p className="text-xs text-muted-foreground">
                    {sufficiency.description}
                  </p>
                  {result.summary === undefined ? null : (
                    <p className="text-sm">{result.summary}</p>
                  )}
                </div>
              )}

              {result === undefined ? null : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Sources</dt>
                    <dd className="tabular-nums">{result.sources.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Findings</dt>
                    <dd className="tabular-nums">{result.findings.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source-backed</dt>
                    <dd className="tabular-nums">
                      {result.findings.filter((item) => item.basis === "source").length}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Conflicts</dt>
                    <dd className="tabular-nums">{result.conflicts.length}</dd>
                  </div>
                </dl>
              )}

              {result === undefined || result.limitsReached.length === 0 ? null : (
                <div className="space-y-1">
                  <p className="text-xs font-medium">
                    Limits reached during this run
                  </p>
                  <p className="flex flex-wrap gap-1">
                    {result.limitsReached.map((kind) => (
                      <code
                        key={kind}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
                      >
                        {kind}
                      </code>
                    ))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The run stopped at these ceilings and returned everything it
                    had found up to that point. The summary above says what each
                    one means.
                  </p>
                </div>
              )}

              {result === undefined || result.errors.length === 0 ? null : (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Errors</p>
                  <ul className="space-y-2">
                    {result.errors.map((resultError, index) => (
                      <li
                        key={`${resultError.code}-${index}`}
                        className="rounded-md border border-border px-3 py-2 text-xs"
                      >
                        <span className="font-mono text-muted-foreground">
                          {resultError.code}
                        </span>
                        <p>{resultError.message}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Findings</CardTitle>
          <CardDescription>
            What the retrieved sources establish, with the passage behind each
            claim.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {record === null || record.findings.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No findings"
              description={
                record === null
                  ? "Findings appear here once a question has been researched."
                  : "The run recorded no findings. Sources it retrieved but could not draw a claim from are listed below."
              }
              className="py-8"
            />
          ) : (
            <ul className="space-y-4">
              {record.findings.map((finding) => {
                const basis = BASIS_PRESENTATION[finding.basis];
                const quotes = evidenceByFinding.get(finding.id) ?? [];

                return (
                  <li
                    key={finding.id}
                    className="space-y-2 border-l-2 border-border pl-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm">{finding.statement}</p>
                      <StatusIndicator
                        tone={basis.tone}
                        label={basis.label}
                        className="shrink-0"
                      />
                    </div>

                    {finding.sourceIds.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Not traceable to retrieved text. Recorded as the
                        model&apos;s own inference rather than presented as
                        something a source states.
                      </p>
                    ) : (
                      quotes.map((evidence) => (
                        <EvidenceBlock key={evidence.id} evidence={evidence} />
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {record === null || record.conflicts.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Conflicts</CardTitle>
            <CardDescription>
              Findings that cannot both be true. Recorded rather than resolved.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ul className="space-y-3">
              {record.conflicts.map((conflict) => (
                <li
                  key={conflict.id}
                  className="space-y-1 rounded-md border border-border px-3 py-2"
                >
                  <div className="flex gap-2">
                    <AlertTriangle
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-amber-500"
                    />
                    <p className="text-sm">{conflict.description}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {conflict.sourceIds
                      .map((id) => sourceById.get(id)?.domain ?? id)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sources</CardTitle>
          <CardDescription>
            Everything the run retrieved. A source that supported no finding is
            kept, because what Orion read and could not use is worth seeing.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {record === null || record.sources.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No sources"
              description="Nothing was retrieved for this run."
              className="py-8"
            />
          ) : (
            <ul className="space-y-3">
              {record.sources.map((source) => (
                <li key={source.id} className="space-y-1 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-muted-foreground"
                    >
                      {source.title ?? source.url}
                    </a>

                    {citedSourceIds.has(source.id) ? null : (
                      <StatusIndicator
                        tone="idle"
                        label="Supported no finding"
                        className="shrink-0"
                      />
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">{source.domain}</code>
                    {source.content === undefined
                      ? " · retrieved without body text, so no quote could come from it"
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity</CardTitle>
          <CardDescription>
            Every event the engine emitted, in order.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {record === null ? (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Ask a question to begin."
              className="py-8"
            />
          ) : (
            <ActivityLog record={record} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
