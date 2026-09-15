import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { StatusIndicator } from "@/components/common/status-indicator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings, grouped by concern.
 *
 * Every control is disabled and every section says which phase delivers it.
 * Nothing here reads or displays a credential: the model provider is
 * configuration rather than code, so the interface names the environment
 * variables it will use and never renders their values. A settings screen that
 * echoed a key back would be a far larger problem than one that admits the
 * feature is not ready.
 */
export default function SettingsPage() {
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
              Which model provider Orion uses. No provider is chosen yet — the
              layer that reads this configuration arrives with the agent engine.
            </CardDescription>
          </div>

          <StatusIndicator tone="idle" label="Not implemented" />
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="ai-model" className="text-sm font-medium">
              Model
            </label>

            <Input id="ai-model" placeholder="Not configured" disabled />
          </div>

          <div className="rounded-md border border-border bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Configured through environment variables —
              <code className="mx-1">LLM_API_STYLE</code>,
              <code className="mx-1">LLM_ENDPOINT</code>,
              <code className="mx-1">LLM_MODEL</code> and
              <code className="mx-1">LLM_API_KEY</code>. Secrets are read
              on the server and are never displayed here or sent to the browser.
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
