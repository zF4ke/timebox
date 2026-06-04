import type { PlanningResult, CalendarBlock, CalendarDay, CalendarProposal } from "../shared/types";

export function importFromJson(content: string): PlanningResult {
  const parsed = JSON.parse(content);
  if (!parsed.finalCalendar && !parsed.result?.finalCalendar) {
    throw new Error("Unrecognized JSON format. Expected a planning result export.");
  }
  // Support both raw result exports and SavedCalendar wrappers
  const result = parsed.result ?? parsed;
  return result as PlanningResult;
}

export function importFromIcs(content: string): PlanningResult {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: CalendarBlock[] = [];
  let inEvent = false;
  let current: Partial<CalendarBlock> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Handle line folding (lines starting with space/tab continue previous line)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue; // skip folded continuations for simple parsing
    }
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
    } else if (line === "END:VEVENT") {
      inEvent = false;
      if (current.start && current.end) {
        const start = new Date(current.start);
        const end = new Date(current.end);
        const durationHours = Math.max(0.5, (end.getTime() - start.getTime()) / 3600000);
        blocks.push({
          id: current.id ?? `imported-${blocks.length}`,
          task_id: null,
          task_name: current.task_name ?? current.description ?? "Imported event",
          type: "work",
          start: current.start,
          end: current.end,
          duration_hours: Math.round(durationHours * 10) / 10,
          description: current.description ?? "Imported from ICS",
          reasoning: "Imported from external calendar file."
        });
      }
    } else if (inEvent) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":");
      if (!key || !value) continue;
      const baseKey = key.split(";")[0];
      if (baseKey === "UID") current.id = value;
      if (baseKey === "SUMMARY") current.task_name = value;
      if (baseKey === "DESCRIPTION") current.description = value;
      if (baseKey === "DTSTART") current.start = parseIcsDate(value);
      if (baseKey === "DTEND") current.end = parseIcsDate(value);
    }
  }

  if (blocks.length === 0) {
    throw new Error("No events found in ICS file.");
  }

  // Group blocks by date
  const daysMap = new Map<string, CalendarDay>();
  for (const block of blocks) {
    const date = block.start.slice(0, 10);
    if (!daysMap.has(date)) {
      daysMap.set(date, {
        date,
        day_name: new Date(date).toLocaleDateString("en-US", { weekday: "long" }),
        assumed_available_hours: 8,
        day_reasoning: "Imported from ICS",
        blocks: []
      });
    }
    daysMap.get(date)!.blocks.push(block);
  }

  const days = Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const startDate = days[0].date;
  const endDate = days[days.length - 1].date;

  const calendar: CalendarProposal = {
    calendar_version: 1,
    planning_window: {
      start_date: startDate,
      end_date: endDate,
      reason: "Imported from ICS file"
    },
    overall_strategy: ["Imported from external calendar."],
    days,
    compromises: [],
    known_weaknesses: ["No agent critique performed on imported data."]
  };

  const now = new Date().toISOString();
  const result: PlanningResult = {
    runId: `imported-${now}`,
    createdAt: now,
    request: { userInput: "Imported from ICS file" },
    stopReason: "Imported from ICS file.",
    interpreterOutput: {
      current_date: startDate,
      planning_window: calendar.planning_window,
      inferred_availability: [],
      fixed_commitments: [],
      student_state: { sleep: "", energy: "", confidence: "" },
      tasks: [],
      assumptions: ["Imported from external calendar file."]
    },
    agentViews: [],
    calendarVersions: [],
    finalCalendar: calendar,
    critiques: [],
    validation: { valid: true, violations: [] },
    evaluation: {
      evaluator: "Schedule Evaluator",
      calendar_version: 1,
      planner_model: "imported",
      evaluator_model: "imported",
      overall_score: 3,
      model_score: 3,
      hard_score: 3,
      hard_metrics: {
        score: 60,
        metrics: [
          {
            name: "generation_time_seconds",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not have model generation time."
          },
          {
            name: "rejection_count",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not include specialist rejections."
          },
          {
            name: "critical_count",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not include critical critique counts."
          },
          {
            name: "major_count",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not include major critique counts."
          },
          {
            name: "deadline_violation_count",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not include task deadline context."
          },
          {
            name: "task_coverage_ratio",
            value: 0,
            score: 0,
            explanation: "Imported calendars do not include inferred task coverage."
          },
          {
            name: "availability_overrun_hours",
            value: 0,
            score: 100,
            explanation: "Imported calendars do not include inferred availability context."
          }
        ]
      },
      dimension_scores: [
        {
          dimension: "requirement_match",
          score: 3,
          rationale: "Imported calendars do not include the original student request."
        },
        {
          dimension: "deadline_safety",
          score: 3,
          rationale: "Imported calendars do not include deadline context."
        },
        {
          dimension: "workload_realism",
          score: 3,
          rationale: "Imported calendars preserve event timing but lack availability context."
        },
        {
          dimension: "academic_priority",
          score: 3,
          rationale: "Imported calendars do not include academic priority context."
        },
        {
          dimension: "wellbeing_balance",
          score: 3,
          rationale: "Imported calendars do not include wellbeing context."
        },
        {
          dimension: "risk_resilience",
          score: 3,
          rationale: "Imported calendars do not include uncertainty context."
        }
      ],
      strengths: ["Events were imported successfully."],
      weaknesses: ["No original request or agent critique is available for this imported calendar."],
      comparison_notes: ["Do not compare this score directly with generated plans."],
      recommendation: "Use this import as calendar data, not as a model-quality evaluation."
    },
    usage: {
      callCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      calls: []
    },
    exports: { json: JSON.stringify(calendar, null, 2), ics: content }
  };

  return result;
}

function parseIcsDate(value: string): string {
  // Handle Z suffix (UTC)
  if (value.endsWith("Z")) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    const h = value.slice(9, 11) || "00";
    const min = value.slice(11, 13) || "00";
    const s = value.slice(13, 15) || "00";
    return `${y}-${m}-${d}T${h}:${min}:${s}Z`;
  }
  // Handle local datetime
  if (value.length >= 15 && /\d{8}T\d{6}/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    const h = value.slice(9, 11);
    const min = value.slice(11, 13);
    const s = value.slice(13, 15);
    return `${y}-${m}-${d}T${h}:${min}:${s}`;
  }
  // Date-only
  if (value.length === 8) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return value;
}
