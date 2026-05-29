import { describe, expect, it } from "vitest";
import type { AgentCritique, CalendarProposal, ConstraintValidation, InterpreterOutput } from "../src/shared/types";
import { evaluateHardMetrics } from "../src/main/metrics";

describe("hard schedule metrics", () => {
  it("computes comparison metrics from final schedule artifacts", () => {
    const metrics = evaluateHardMetrics({
      calendar: calendar(),
      critiques: critiques(),
      validation: validation(),
      interpreterOutput: interpreter(),
      generationTimeSeconds: 120
    });

    const byName = Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric]));

    expect(byName.generation_time_seconds.value).toBe(120);
    expect(byName.rejection_count.value).toBe(1);
    expect(byName.critical_count.value).toBe(1);
    expect(byName.major_count.value).toBe(2);
    expect(byName.deadline_violation_count.value).toBe(1);
    expect(byName.task_coverage_ratio.value).toBe(0.5);
    expect(byName.availability_overrun_hours.value).toBe(1);
    expect(metrics.score).toBeGreaterThanOrEqual(0);
    expect(metrics.score).toBeLessThanOrEqual(100);
  });
});

function critiques(): AgentCritique[] {
  return [
    {
      agent: "Deadline Agent",
      calendar_version: 1,
      approval: "reject",
      severity: "major",
      critiques: [
        {
          issue: "A deadline is missed.",
          severity: "critical",
          affected_tasks: ["T1"],
          affected_days: ["2026-05-04"],
          suggested_fix: "Move work earlier."
        }
      ],
      acknowledged_compromises: [],
      overall_comment: ""
    },
    {
      agent: "Risk Agent",
      calendar_version: 1,
      approval: "approve_with_minor_concerns",
      severity: "major",
      critiques: [],
      acknowledged_compromises: [],
      overall_comment: ""
    }
  ];
}

function validation(): ConstraintValidation {
  return {
    valid: false,
    violations: [{ code: "block_after_deadline", message: "Late work.", severity: "error" }]
  };
}

function interpreter(): InterpreterOutput {
  return {
    current_date: "2026-05-04",
    planning_window: { start_date: "2026-05-04", end_date: "2026-05-05", reason: "" },
    inferred_availability: [],
    fixed_commitments: [],
    student_state: { sleep: "", energy: "", confidence: "" },
    tasks: [
      { task_id: "T1", name: "DB lab", raw_mentions: [], inferred_deadline: null, uncertainties: [] },
      { task_id: "T2", name: "AI quiz", raw_mentions: [], inferred_deadline: null, uncertainties: [] }
    ],
    assumptions: []
  };
}

function calendar(): CalendarProposal {
  return {
    calendar_version: 1,
    planning_window: { start_date: "2026-05-04", end_date: "2026-05-05", reason: "" },
    overall_strategy: [],
    days: [
      {
        date: "2026-05-04",
        day_name: "Monday",
        assumed_available_hours: 2,
        day_reasoning: "",
        blocks: [
          {
            id: "b1",
            task_id: "T1",
            task_name: "DB lab",
            type: "work",
            start: "2026-05-04T10:00:00+01:00",
            end: "2026-05-04T13:00:00+01:00",
            duration_hours: 3,
            description: "Work.",
            reasoning: ""
          }
        ]
      }
    ],
    compromises: [],
    known_weaknesses: []
  };
}
