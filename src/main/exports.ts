import type { CalendarBlock, CalendarProposal, PlanningResult } from "../shared/types";

export function createJsonExport(result: Omit<PlanningResult, "exports">): string {
  return JSON.stringify(result, null, 2);
}

export function createIcsExport(calendar: CalendarProposal): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AASMA//Multi-Agent Student Calendar Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  for (const block of calendar.days.flatMap((day) => day.blocks)) {
    lines.push(...eventLines(block));
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function eventLines(block: CalendarBlock): string[] {
  const summary = block.task_name ?? block.description ?? "Calendar block";
  const description = [block.description, block.reasoning].filter(Boolean).join("\\n\\nReasoning: ");
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(block.id)}@multi-agent-calendar-planner.local`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(new Date(block.start))}`,
    `DTEND:${formatIcsDate(new Date(block.end))}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "END:VEVENT"
  ];
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
