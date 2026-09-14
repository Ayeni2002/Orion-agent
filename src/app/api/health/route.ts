import { NextResponse } from "next/server";

import { getSystemStatus } from "@/server/services/system";

/**
 * Liveness endpoint.
 *
 * Route Handlers stay thin: parse and validate the request, delegate to a
 * service, shape the HTTP response. Business logic belongs in
 * `src/server/services` — see the convention documented in
 * `src/server/services/index.ts`.
 */
export function GET() {
  return NextResponse.json(getSystemStatus());
}
