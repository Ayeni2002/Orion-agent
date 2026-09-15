/**
 * A clean provider environment for every test file.
 *
 * `docs/DEVELOPMENT_PHASES.md` requires the suite to pass with no API key
 * present, and Phase 5 makes that a structural property rather than a lucky one.
 * Before retrieval could be configured, every research run resolved to the
 * development adapter whatever the environment said; now it resolves to the real
 * adapter when `LLM_API_STYLE` points at a search-capable endpoint. A developer
 * with those variables exported in their shell would have had `npm test` start
 * making live, metered requests — which is exactly the dependency the rule
 * exists to forbid.
 *
 * Vitest does not load `.env.local`, so this is not about the file an operator
 * fills in. It is about the ambient environment a developer's shell already
 * has, which a test inherits without asking.
 *
 * Deleting rather than blanking, because "not set" is the state a fresh
 * checkout and CI both have, and it is the state the defaults are written for.
 * A file that needs one of these stubs it explicitly with `vi.stubEnv`, which
 * also makes the dependency visible in that file.
 *
 * This runs once per test file. It is not a global mock: nothing here changes
 * what the code under test does, only what it reads.
 */

const PROVIDER_VARIABLES = [
  "LLM_API_STYLE",
  "LLM_ENDPOINT",
  "LLM_MODEL",
  "LLM_API_KEY",
  "RESEARCH_SEARCH_MODEL",
  "RESEARCH_MAX_TASKS",
  "RESEARCH_MAX_SOURCES_PER_TASK",
  "RESEARCH_MAX_SOURCES",
  "RESEARCH_MAX_FINDINGS",
  "RESEARCH_MAX_DURATION_MS",
];

for (const name of PROVIDER_VARIABLES) {
  delete process.env[name];
}
