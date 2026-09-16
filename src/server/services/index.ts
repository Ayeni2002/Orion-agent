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
 * service module here. Four of those now exist: `./agent.ts` owns objective
 * validation, starts an execution and reads one back; `./tools.ts` reports the
 * registered tool catalogue; `./research.ts` validates a question, runs it to
 * completion and projects the records a list needs; and `./reports.ts` turns a
 * finished research result into a report, refusing with the status that says why
 * when there is nothing to report on. Projects remain unimplemented.
 */
export {};
