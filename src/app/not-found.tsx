import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <p className="font-mono text-sm text-muted-foreground">404</p>

      <h1 className="text-2xl font-semibold tracking-tight">
        That route does not exist
      </h1>

      <p className="text-sm text-muted-foreground">
        The page you asked for is not part of Orion.
      </p>

      <Button asChild variant="outline">
        <Link href="/">Back to start</Link>
      </Button>
    </div>
  );
}
