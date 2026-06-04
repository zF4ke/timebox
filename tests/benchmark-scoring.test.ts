import { describe, expect, it } from "vitest";
import type { PlanningResult } from "../src/shared/types";
import { scoreBenchmarkResult, type BenchmarkScenario } from "../src/main/benchmarkScoring";

describe("benchmark scenario scoring", () => {
  it("rewards complete, accepted schedules", () => {
    const score = scoreBenchmarkResult(baseResult(), scenario());

    expect(score.score).toBeGreaterThan(85);
    expect(score.expectedTaskCoverage).toBe(100);
    expect(score.mistakes).toHaveLength(0);
  });

  it("labels deterministic mistakes for missing tasks and late work", () => {
    const result = baseResult();
    result.interpreterOutput.tasks = result.interpreterOutput.tasks.slice(0, 1);
    result.finalCalendar.days[0].blocks = result.finalCalendar.days[0].blocks.slice(0, 1);
    result.finalCalendar.days[0].blocks[0].end = "2026-06-04T23:30:00+01:00";
    result.finalCalendar.overall_strategy = ["Schedule database project before its deadline."];
    result.validation.violations.push({
      code: "block_after_deadline",
      message: "Task ends after deadline.",
      severity: "error"
    });
    result.stopReason = "Maximum iterations reached. Selected best available calendar.";

    const score = scoreBenchmarkResult(result, scenario());
    const codes = score.mistakes.map((mistake) => mistake.code);

    expect(score.score).toBeLessThan(85);
    expect(codes).toContain("missing_expected_task");
    expect(codes).toContain("late_work_when_avoided");
    expect(codes).toContain("block_after_deadline");
    expect(codes).toContain("max_iterations_fallback");
  });
});

function scenario(): BenchmarkScenario {
  return {
    id: "demo",
    promptFile: "demo.txt",
    title: "Demo scenario",
    difficulty: "medium",
    expectedTaskKeywords: [["database", "project"], ["statistics", "quiz"]],
    avoidLateNight: true,
    minWorkBlocks: 2
  };
}

function baseResult(): PlanningResult {
  return {
    runId: "r1",
    createdAt: "2026-06-04T10:00:00.000Z",
    request: { userInput: "Plan database project and statistics quiz.", quorum: 3, maxIterations: 2 },
    stopReason: "Accepted by 5/5 agents with no critical critiques.",
    interpreterOutput: {
      current_date: "2026-06-04",
      planning_window: { start_date: "2026-06-04", end_date: "2026-06-06", reason: "" },
      inferred_availability: [],
      fixed_commitments: [],
      student_state: { sleep: "", energy: "", confidence: "" },
      tasks: [
        {
          task_id: "T1",
          name: "Database project",
          raw_mentions: ["database project"],
          inferred_deadline: "2026-06-06T23:59:00+01:00",
          uncertainties: []
        },
        {
          task_id: "T2",
          name: "Statistics quiz",
          raw_mentions: ["statistics quiz"],
          inferred_deadline: "2026-06-05T16:00:00+01:00",
          uncertainties: []
        }
      ],
      assumptions: []
    },
    agentViews: [],
    calendarVersions: [
      {
        calendar: calendar(),
        critiques: [],
        validation: { valid: true, violations: [] },
        approvals: 5,
        hasCritical: false
      }
    ],
    finalCalendar: calendar(),
    critiques: ["Deadline Agent", "Grade Agent", "Effort Agent", "Wellbeing Agent", "Risk Agent"].map((agent) => ({
      agent: agent as PlanningResult["critiques"][number]["agent"],
      calendar_version: 1,
      approval: "approve" as const,
      severity: "none" as const,
      critiques: [],
      acknowledged_compromises: [],
      overall_comment: ""
    })),
    validation: { valid: true, violations: [] },
    evaluation: {
      evaluator: "Schedule Evaluator",
      calendar_version: 1,
      planner_model: "model",
      evaluator_model: "model",
      overall_score: 4,
      model_score: 4,
      hard_score: 4,
      hard_metrics: { score: 80, metrics: [] },
      dimension_scores: [],
      strengths: [],
      weaknesses: [],
      comparison_notes: [],
      recommendation: ""
    },
    usage: {
      callCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      calls: []
    },
    exports: { json: "{}", ics: "" }
  };
}

function calendar() {
  return {
    calendar_version: 1,
    planning_window: { start_date: "2026-06-04", end_date: "2026-06-06", reason: "" },
    overall_strategy: ["Schedule database project and statistics quiz before deadlines."],
    days: [
      {
        date: "2026-06-04",
        day_name: "Thursday",
        assumed_available_hours: 4,
        day_reasoning: "Balanced workload.",
        blocks: [
          {
            id: "b1",
            task_id: "T1",
            task_name: "Database project",
            type: "work" as const,
            start: "2026-06-04T15:00:00+01:00",
            end: "2026-06-04T17:00:00+01:00",
            duration_hours: 2,
            description: "Work on database project.",
            reasoning: "Due soon."
          },
          {
            id: "b2",
            task_id: "T2",
            task_name: "Statistics quiz",
            type: "work" as const,
            start: "2026-06-04T18:00:00+01:00",
            end: "2026-06-04T19:00:00+01:00",
            duration_hours: 1,
            description: "Review statistics quiz formulas.",
            reasoning: "Needs practice."
          }
        ]
      }
    ],
    compromises: [],
    known_weaknesses: []
  };
}
