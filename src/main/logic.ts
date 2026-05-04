import type { AgentCritique, CalendarVersionRecord } from "../shared/types";

export function countApprovals(critiques: AgentCritique[]): number {
  return critiques.filter(
    (critique) => critique.approval === "approve" || critique.approval === "approve_with_minor_concerns"
  ).length;
}

export function hasCriticalCritique(critiques: AgentCritique[]): boolean {
  return critiques.some(
    (critique) =>
      critique.severity === "critical" || critique.critiques.some((issue) => issue.severity === "critical")
  );
}

export function chooseBestCalendarVersion(records: CalendarVersionRecord[]): CalendarVersionRecord {
  if (records.length === 0) {
    throw new Error("Cannot choose a best calendar from an empty version list.");
  }

  return [...records].sort(compareCalendarVersions).at(-1)!;
}

function compareCalendarVersions(a: CalendarVersionRecord, b: CalendarVersionRecord): number {
  const aCritical = countSeverity(a, "critical");
  const bCritical = countSeverity(b, "critical");
  const aMajor = countSeverity(a, "major");
  const bMajor = countSeverity(b, "major");

  if (a.validation.valid !== b.validation.valid) {
    return a.validation.valid ? 1 : -1;
  }
  if (aCritical !== bCritical) {
    return bCritical - aCritical;
  }
  if (aMajor !== bMajor) {
    return bMajor - aMajor;
  }
  if (a.approvals !== b.approvals) {
    return a.approvals - b.approvals;
  }
  return a.calendar.calendar_version - b.calendar.calendar_version;
}

function countSeverity(record: CalendarVersionRecord, severity: "major" | "critical"): number {
  return record.critiques.reduce((count, critique) => {
    const ownSeverity = critique.severity === severity ? 1 : 0;
    const issueSeverity = critique.critiques.filter((issue) => issue.severity === severity).length;
    return count + ownSeverity + issueSeverity;
  }, 0);
}
