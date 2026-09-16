import type { Metadata } from "next";

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
import { Input } from "@/components/ui/input";
import { getEngineCapabilities } from "@/server/services/agent";
import { getResearchCapabilities } from "@/server/services/research";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings, grouped by concern.
 *
 * **What changed here.** The AI configuration card used to describe a
 * capability rather than report one: it said the layer reading that
 * configuration "arrives with the agent engine" and was marked "Not
 * implemented". Both stopped being true two phases before this was written —
 * `resolveModelProvider` and `getModelProviderConfig` exist and have been read
 * on every run since. A settings screen that announces a feature as missing
 * while the running server is using it is worse than one that stays silent,
 * because the reader has no way to tell which of the two is wrong.
 *
 * It now reports the *resolved* provider, which is the question an operator
 * actually has after setting `LLM_MODEL`: did it take effect? `isExternal` is
 * the field that answers it, because it is false for the deterministic
 * development adapter — so "Live" cannot be shown for a run that contacted
 * nothing.
 *
 * `force-dynamic` is what makes that report honest. Without it Next would
 * resolve the provider during a static render and serve the build machine's
 * environment for the life of the deployment, so an operator who changed a
 * variable would keep reading the old value. The capabilities route sets it for
 * the same reason.
 *
 * Nothing here reads a credential's value. `ExecutionProvider` has no field for
 * one — only the descriptor's label, model and `isExternal` — and the label is
 * generic on purpose so a base URL carrying userinfo cannot reach the page.
 */
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const engine = getEngineCapabilities();
  const research = getResearchCapabilities();

  const provider = engine.provider;

  const providerTone: StatusTone =
    provider === null ? "error" : provider.isExternal ? "success" : "idle";

  const providerLabel =
    provider === null
      ? "Misconfigured"
      : provider.isExternal
        ? "Live"
        : "Development adapter";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Account, preferences and how Orion is configured."
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>
              Identity and access. Authentication arrives with the phase that
              introduces the database schema and Row Level Security.
            </CardDescription>
          </div>

          <StatusIndicator tone="idle" label="Later phase" />
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="account-email" className="text-sm font-medium">
              Email
            </label>

            <Input
              id="account-email"
              type="email"
              placeholder="Not signed in"
              disabled
            />
          </div>

          <Button type="button" variant="outline" disabled>
            Sign in
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Preferences</CardTitle>
            <CardDescription>
              Appearance and defaults for how objectives are presented.
            </CardDescription>
          </div>

          <StatusIndicator tone="idle" label="Later phase" />
        </CardHeader>

        <CardContent className="space-y-2">
          <label htmlFor="preferences-theme" className="text-sm font-medium">
            Theme
          </label>

          <select
            id="preferences-theme"
            disabled
            className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option>System</option>
          </select>

          <p className="text-xs text-muted-foreground">
            The dark palette exists in <code>globals.css</code>; the toggle that
            applies it is not built yet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">AI configuration</CardTitle>
            <CardDescription>
              Which model provider Orion uses, as resolved by the running server.
            </CardDescription>
          </div>

          <StatusIndicator tone={providerTone} label={providerLabel} />
        </CardHeader>

        <CardContent className="space-y-4">
          {provider === null ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <p className="text-xs">
                {engine.configurationError ??
                  "The model provider could not be configured."}
              </p>
            </div>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">Provider</dt>
                <dd className="text-sm font-medium">{provider.label}</dd>
              </div>

              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">Model</dt>
                <dd className="text-sm font-medium">{provider.model}</dd>
              </div>

              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">Retrieval</dt>
                <dd className="text-sm font-medium">
                  {research.searchConfigured ? "Configured" : "Not configured"}
                </dd>
              </div>
            </dl>
          )}

          {/*
            Shown only when the resolved provider is the development adapter,
            which is a supported state rather than an error — so it reads as an
            explanation, not a warning.
          */}
          {provider !== null && !provider.isExternal ? (
            <p className="text-xs text-muted-foreground">
              This adapter performs no inference and contacts nothing, so its
              output is derived from the objective text and must not be read as a
              model&rsquo;s answer. Set <code>LLM_API_STYLE</code> to{" "}
              <code>openai</code> and point <code>LLM_ENDPOINT</code> at a real
              endpoint to change that.
            </p>
          ) : null}

          {/*
            The pairing is the point, so it is stated where both halves are
            visible: an operator who has just configured a free endpoint would
            otherwise reasonably expect research to work, and the failure would
            surface as `search_not_configured` on another page.
          */}
          {!research.searchConfigured ? (
            <p className="text-xs text-muted-foreground">
              Retrieval needs an OpenRouter endpoint, because its <code>web</code>{" "}
              plugin is the one this build knows how to ask. Every other endpoint
              speaks the same protocol but cannot search, so research runs stop
              before planning with <code>search_not_configured</code> rather than
              appearing to search and finding nothing.
            </p>
          ) : null}

          <div className="rounded-md border border-border bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Configured through environment variables —
              <code className="mx-1">LLM_API_STYLE</code>,
              <code className="mx-1">LLM_ENDPOINT</code>,
              <code className="mx-1">LLM_MODEL</code> and
              <code className="mx-1">LLM_API_KEY</code>. Secrets are read on the
              server and are never displayed here or sent to the browser; this
              panel reports what resolved, never a credential.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Security</CardTitle>
            <CardDescription>
              Data access is governed by Row Level Security in PostgreSQL rather
              than by the secrecy of the public key.
            </CardDescription>
          </div>

          <StatusIndicator tone="idle" label="Later phase" />
        </CardHeader>

        <CardContent>
          <p className="text-xs text-muted-foreground">
            Sessions, API keys and audit history belong to the phase that adds
            authentication and the database schema.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
