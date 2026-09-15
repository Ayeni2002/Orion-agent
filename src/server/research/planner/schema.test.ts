import { describe, expect, it } from "vitest";

import {
  RESEARCH_QUERY_MAX_LENGTH,
  RESEARCH_QUERY_MIN_LENGTH,
} from "../tools/search";
import {
  MAX_RESEARCH_TASKS,
  RESEARCH_QUESTION_MAX_LENGTH,
  RESEARCH_QUESTION_MIN_LENGTH,
  RESEARCH_RESTATEMENT_MAX_LENGTH,
  RESEARCH_RESTATEMENT_MIN_LENGTH,
  researchPlanSchema,
  validateResearchPlan,
} from "./schema";

/**
 * The plan contract, §7.
 *
 * §7 requires a plan of Zod-validated structured tasks rather than a paragraph,
 * and the tests are grouped by the three things that requirement buys:
 *
 *   - a plan is *countable*, so §10's limits have something to bound;
 *   - a plan is *executable*, so every task carries a query the search tool will
 *     accept — the bounds are imported from the tool rather than restated, and
 *     the last group asserts that identity directly;
 *   - a plan is *individually addressable*, so §15 can evaluate task by task.
 *
 * The duplicate-query rule gets its own group because it is the only semantic
 * check Zod cannot express, and it is the one whose failure mode is silent:
 * two tasks sharing a query look like two independent searches and are one.
 */

/** A valid plan, so each test can vary one thing. */
function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restatement: "Establish what grid-scale battery storage cost between 2019 and 2024.",
    tasks: [
      {
        question: "What did grid-scale battery pack costs fall to?",
        query: "grid-scale battery pack cost 2024",
      },
    ],
    ...overrides,
  };
}

describe("researchPlanSchema", () => {
  it("accepts a well-formed plan", () => {
    expect(researchPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it("refuses a plan with no restatement", () => {
    expect(researchPlanSchema.safeParse({ tasks: plan().tasks }).success).toBe(false);
  });

  it("refuses a restatement too short to be a reading of anything", () => {
    expect(
      researchPlanSchema.safeParse(
        plan({ restatement: "a".repeat(RESEARCH_RESTATEMENT_MIN_LENGTH - 1) }),
      ).success,
    ).toBe(false);
  });

  it("refuses a restatement longer than the ceiling", () => {
    expect(
      researchPlanSchema.safeParse(
        plan({ restatement: "a".repeat(RESEARCH_RESTATEMENT_MAX_LENGTH + 1) }),
      ).success,
    ).toBe(false);
  });

  it("refuses an empty task list", () => {
    // A plan with no tasks is the paragraph §7 rules out, wearing the shape of
    // a plan. Nothing would be looked up.
    expect(researchPlanSchema.safeParse(plan({ tasks: [] })).success).toBe(false);
  });

  it("accepts a plan at the task ceiling", () => {
    const tasks = Array.from({ length: MAX_RESEARCH_TASKS }, (_unused, index) => ({
      question: `What does source number ${index} establish about storage?`,
      query: `storage question ${index}`,
    }));

    expect(researchPlanSchema.safeParse(plan({ tasks })).success).toBe(true);
  });

  it("refuses a plan over the task ceiling", () => {
    const tasks = Array.from({ length: MAX_RESEARCH_TASKS + 1 }, (_unused, index) => ({
      question: `What does source number ${index} establish about storage?`,
      query: `storage question ${index}`,
    }));

    expect(researchPlanSchema.safeParse(plan({ tasks })).success).toBe(false);
  });

  it("refuses a task with no query", () => {
    // A task with no query is a task that retrieves nothing. The schema refuses
    // to produce one rather than letting an unsearchable task look like work.
    expect(
      researchPlanSchema.safeParse(
        plan({ tasks: [{ question: "What did grid-scale storage cost?" }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a task question below its minimum length", () => {
    expect(
      researchPlanSchema.safeParse(
        plan({
          tasks: [
            {
              question: "a".repeat(RESEARCH_QUESTION_MIN_LENGTH - 1),
              query: "grid-scale storage cost",
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("refuses a task question above its maximum length", () => {
    expect(
      researchPlanSchema.safeParse(
        plan({
          tasks: [
            {
              question: "a".repeat(RESEARCH_QUESTION_MAX_LENGTH + 1),
              query: "grid-scale storage cost",
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace from a restatement and a query", () => {
    const parsed = researchPlanSchema.parse(
      plan({ restatement: "  Establish the cost of grid-scale storage.  " }),
    );

    expect(parsed.restatement).toBe("Establish the cost of grid-scale storage.");
  });

  it("refuses a plan that is not an object", () => {
    expect(researchPlanSchema.safeParse("a paragraph of prose").success).toBe(false);
  });

  it("refuses a plan that is an array of strings", () => {
    // The exact shape §7 rules out: a list of sentences describing an approach.
    expect(
      researchPlanSchema.safeParse({
        restatement: "Look into grid-scale storage costs.",
        tasks: ["Search for costs", "Search for capacity"],
      }).success,
    ).toBe(false);
  });
});

describe("the query contract", () => {
  it("is the search tool's contract, imported rather than restated", () => {
    // Two copies of the bound would drift, and the drift would appear as a plan
    // that is valid when written and invalid when executed.
    const justUnder = "a".repeat(RESEARCH_QUERY_MIN_LENGTH - 1);
    const justOver = "a".repeat(RESEARCH_QUERY_MAX_LENGTH + 1);

    expect(
      researchPlanSchema.safeParse(
        plan({ tasks: [{ question: "What did storage cost?", query: justUnder }] }),
      ).success,
    ).toBe(false);

    expect(
      researchPlanSchema.safeParse(
        plan({ tasks: [{ question: "What did storage cost?", query: justOver }] }),
      ).success,
    ).toBe(false);
  });

  it("accepts a query at the minimum length", () => {
    expect(
      researchPlanSchema.safeParse(
        plan({
          tasks: [
            {
              question: "What did storage cost?",
              query: "a".repeat(RESEARCH_QUERY_MIN_LENGTH),
            },
          ],
        }),
      ).success,
    ).toBe(true);
  });
});

describe("validateResearchPlan", () => {
  it("accepts a plan whose queries are all different", () => {
    expect(
      validateResearchPlan({
        restatement: "Establish the cost and the capacity of grid-scale storage.",
        tasks: [
          { question: "What did storage cost?", query: "grid storage cost" },
          { question: "What capacity was installed?", query: "grid storage capacity" },
        ],
      }),
    ).toStrictEqual([]);
  });

  it("refuses two tasks searching for the same thing", () => {
    const issues = validateResearchPlan({
      restatement: "Establish the cost of grid-scale storage.",
      tasks: [
        { question: "What did storage cost?", query: "grid storage cost" },
        { question: "How much did storage cost?", query: "grid storage cost" },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(1);
    expect(issues[0]?.message).toContain("task 0");
  });

  it("catches a repeat that differs only in case", () => {
    const issues = validateResearchPlan({
      restatement: "Establish the cost of grid-scale storage.",
      tasks: [
        { question: "What did storage cost?", query: "Grid Storage Cost" },
        { question: "How much did storage cost?", query: "grid storage cost" },
      ],
    });

    expect(issues).toHaveLength(1);
  });

  it("catches a repeat that differs only in whitespace", () => {
    const issues = validateResearchPlan({
      restatement: "Establish the cost of grid-scale storage.",
      tasks: [
        { question: "What did storage cost?", query: "grid  storage   cost" },
        { question: "How much did storage cost?", query: "grid storage cost" },
      ],
    });

    expect(issues).toHaveLength(1);
  });

  it("allows two tasks that ask different questions with different queries", () => {
    // Two questions can legitimately be answered by different queries, and
    // refusing them would reject a plan for a flaw that is not one.
    expect(
      validateResearchPlan({
        restatement: "Establish what storage cost and what it cost before.",
        tasks: [
          { question: "What does storage cost?", query: "grid storage cost 2025" },
          { question: "What did storage cost before?", query: "grid storage cost 2019" },
        ],
      }),
    ).toStrictEqual([]);
  });

  it("reports every repeat, not only the first", () => {
    const issues = validateResearchPlan({
      restatement: "Establish the cost of grid-scale storage.",
      tasks: [
        { question: "What did storage cost?", query: "grid storage cost" },
        { question: "How much did storage cost?", query: "grid storage cost" },
        { question: "And what did it cost?", query: "grid storage cost" },
      ],
    });

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.index)).toStrictEqual([1, 2]);
  });

  it("accepts a single-task plan", () => {
    expect(
      validateResearchPlan({
        restatement: "Establish the cost of grid-scale storage.",
        tasks: [{ question: "What did storage cost?", query: "grid storage cost" }],
      }),
    ).toStrictEqual([]);
  });
});
