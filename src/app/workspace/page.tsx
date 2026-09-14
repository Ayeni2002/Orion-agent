import type { Metadata } from "next";

import { ObjectiveForm } from "@/components/workspace/objective-form";

export const metadata: Metadata = {
  title: "Workspace",
};

export default function WorkspacePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want Orion to research. This is where the agent will
          plan, act and report once the engine exists.
        </p>
      </header>

      <ObjectiveForm />
    </div>
  );
}
