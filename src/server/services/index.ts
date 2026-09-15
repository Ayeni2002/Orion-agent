/**
 * Service layer — where business logic lives.
 *
 * Convention for this project, so later phases do not have to invent one:
 *
 *   Route Handler (`src/app/api/**\/route.ts`)
 *     Thin. Parses and validates the request, calls a service, shapes the
 *     HTTP response. No business logic, no direct database calls.
 *
 *   Service (`src/server/services/**`)
 *     Owns the rules. Takes plain arguments, returns plain data, throws typed
 *     errors. Must not import React, `next/headers`, or anything from
 *     `src/components` — that keeps it callable from a Route Handler, a Server
 *     Action, or a test without a request in scope.
 *
 *   Client (`src/lib/supabase/**`)
 *     Owns connectivity only.
 *
 * Agent execution, projects, research and reports are each added as their own
 * service module here. Two of those exist: `./agent.ts` owns objective
 * validation, starts an execution and reads one back, and `./tools.ts` reports
 * the registered tool catalogue. Projects, research and reports are still
 * unimplemented.
 */
export {};
