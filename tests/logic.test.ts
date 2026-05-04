import { describe, expect, it } from "vitest";
import type { AgentCritique, CalendarVersionRecord } from "../src/shared/types";
import { chooseBestCalendarVersion, countApprovals, hasCriticalCritique } from "../src/main/logic";

function critique(agent: AgentCritique["agent"], approval: AgentCritique["approval"], severity: AgentCritique["severity"]): AgentCritique {
  return {
    agent,
    calendar_version: 1,
    approval,
    severity,
    critiques: [],
    acknowledged_compromises: [],
    overall_comment: ""
  };
}

describe("planner decision logic", () => {
  it("counts approvals and approvals with minor concerns toward quorum", () => {
    expect(
      countApprovals([
        critique("Deadline Agent", "approve", "none"),
        critique("Grade Agent", "approve_with_minor_concerns", "minor"),
        critique("Risk Agent", "reject", "major")
      ])
    ).toBe(2);
  });

  it("detects critical critiques on the agent or issue level", () => {
    const critiques = [critique("Deadline Agent", "reject", "major")];
    critiques[0].critiques.push({
      issue: "Deadline task is scheduled too late.",
      severity: "critical",
      affected_tasks: ["T1"],
      affected_days: ["2026-05-05"],
      suggested_fix: "Move the task earlier."
    });

    expect(hasCriticalCritique(critiques)).toBe(true);
  });

  it("chooses the best fallback by validity, severity, approvals, then later version", () => {
    const records: CalendarVersionRecord[] = [
      record(1, true, 1, 2, 2),
      record(2, true, 0, 2, 2),
      record(3, true, 0, 1, 3)
    ];

    expect(chooseBestCalendarVersion(records).calendar.calendar_version).toBe(3);
  });
});

function record(
  version: number,
  valid: boolean,
  criticalIssues: number,
  majorIssues: number,
  approvals: number
): CalendarVersionRecord {
  const critiques = [critique("Deadline Agent", approvals > 0 ? "approve" : "reject", "none")];
  for (let index = 0; index < criticalIssues; index += 1) {
    critiques.push(critique("Risk Agent", "reject", "critical"));
  }
  for (let index = 0; index < majorIssues; index += 1) {
    critiques.push(critique("Wellbeing Agent", "reject", "major"));
  }

  return {
    calendar: {
      calendar_version: version,
      planning_window: {
        start_date: "2026-05-04",
        end_date: "2026-05-08",
        reason: ""
      },
      overall_strategy: [],
      days: [],
      compromises: [],
      known_weaknesses: []
    },
    critiques,
    validation: {
      valid,
      violations: valid ? [] : [{ code: "invalid", message: "Invalid", severity: "error" }]
    },
    approvals,
    hasCritical: criticalIssues > 0
  };
}
