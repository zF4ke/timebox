import fs from "node:fs";
import path from "node:path";
import type { PlanningResult } from "../shared/types";

const DEBUG_DIR = path.join(process.cwd(), "debug");

function ensureDir(): void {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }
}

function timestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
}

export function saveRunLog(result: PlanningResult): void {
  ensureDir();
  const fileName = `${timestamp()}_run_${result.runId}.json`;
  const filePath = path.join(DEBUG_DIR, fileName);

  const payload = {
    runId: result.runId,
    createdAt: result.createdAt,
    stopReason: result.stopReason,
    request: result.request,
    interpreterOutput: result.interpreterOutput,
    agentViews: result.agentViews,
    calendarVersions: result.calendarVersions.map((v) => ({
      calendarVersion: v.calendar.calendar_version,
      approvals: v.approvals,
      hasCritical: v.hasCritical,
      validation: v.validation,
      critiques: v.critiques.map((c) => ({
        agent: c.agent,
        approval: c.approval,
        severity: c.severity,
        issueCount: c.critiques.length
      }))
    })),
    finalCalendar: result.finalCalendar,
    finalCritiques: result.critiques.map((c) => ({
      agent: c.agent,
      approval: c.approval,
      severity: c.severity
    })),
    finalValidation: result.validation
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[debug] saved run log → ${filePath}`);
}

export function saveRawResponse(schemaName: string, content: string): void {
  ensureDir();
  const fileName = `${timestamp()}_raw_${schemaName}.json`;
  const filePath = path.join(DEBUG_DIR, fileName);
  fs.writeFileSync(filePath, content, "utf-8");
}
