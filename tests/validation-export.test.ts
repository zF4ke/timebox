import { describe, expect, it } from "vitest";
import type { CalendarProposal, InterpreterOutput } from "../src/shared/types";
import { createIcsExport } from "../src/main/exports";
import { validateCalendar } from "../src/main/validation";

describe("constraint checker", () => {
  it("accepts a structurally valid calendar", () => {
    const validation = validateCalendar(validCalendar(), interpreter());

    expect(validation.valid).toBe(true);
    expect(validation.violations).toHaveLength(0);
  });

  it("rejects blocks after task deadlines and days above availability", () => {
    const calendar = validCalendar();
    calendar.days[0].assumed_available_hours = 1;
    calendar.days[0].blocks[0].end = "2026-05-05T18:00:00+01:00";

    const validation = validateCalendar(calendar, interpreter());

    expect(validation.valid).toBe(false);
    expect(validation.violations.map((violation) => violation.code)).toContain("daily_availability_exceeded");
    expect(validation.violations.map((violation) => violation.code)).toContain("block_after_deadline");
  });
});

describe("ICS export", () => {
  it("creates importable event lines from final calendar blocks", () => {
    const ics = createIcsExport(validCalendar());

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:DB lab");
    expect(ics).toContain("DTSTART:20260504T130000Z");
  });
});

function interpreter(): InterpreterOutput {
  return {
    current_date: "2026-05-04",
    planning_window: {
      start_date: "2026-05-04",
      end_date: "2026-05-08",
      reason: "Test"
    },
    inferred_availability: [],
    fixed_commitments: [],
    student_state: {
      sleep: "ok",
      energy: "ok",
      confidence: "high"
    },
    tasks: [
      {
        task_id: "T1",
        name: "DB lab",
        raw_mentions: [],
        inferred_deadline: "2026-05-05T17:00:00+01:00",
        uncertainties: []
      }
    ],
    assumptions: []
  };
}

function validCalendar(): CalendarProposal {
  return {
    calendar_version: 1,
    planning_window: {
      start_date: "2026-05-04",
      end_date: "2026-05-08",
      reason: "Test"
    },
    overall_strategy: ["Start before the deadline."],
    days: [
      {
        date: "2026-05-04",
        day_name: "Monday",
        assumed_available_hours: 3,
        day_reasoning: "Available afternoon.",
        blocks: [
          {
            id: "block-1",
            task_id: "T1",
            task_name: "DB lab",
            type: "work",
            start: "2026-05-04T14:00:00+01:00",
            end: "2026-05-04T16:00:00+01:00",
            duration_hours: 2,
            description: "Start lab.",
            reasoning: "Deadline is soon."
          }
        ]
      }
    ],
    compromises: [],
    known_weaknesses: []
  };
}
