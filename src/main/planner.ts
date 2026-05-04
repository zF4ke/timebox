import crypto from "node:crypto";
import type {
  AgentCritique,
  AgentName,
  CalendarProposal,
  CalendarVersionRecord,
  InterpreterOutput,
  PlannerDefaults,
  PlanningRequest,
  PlanningResult,
  ProgressEvent,
  SpecialistAgentView
} from "../shared/types";

export type ProgressCallback = (event: Omit<ProgressEvent, "timestamp">) => void;

function noopProgress(): void {
  /* noop */
}

function logAndEmit(emit: ProgressCallback, ev: Omit<ProgressEvent, "timestamp">): void {
  const tag = `[planner] ${ev.phase}${ev.iteration ? ` v${ev.iteration}` : ""}${ev.agent ? ` ${ev.agent}` : ""} ${ev.status}`;
  if (ev.summary) {
    console.log(`${tag} — ${ev.summary}`);
  } else {
    console.log(tag);
  }
  emit(ev);
}
import { createIcsExport, createJsonExport } from "./exports";
import { countApprovals, chooseBestCalendarVersion, hasCriticalCritique } from "./logic";
import { callOpenRouterJson } from "./openrouter";
import { calendarSchema, critiqueBundleSchema, interpreterSchema, specialistSchema } from "./schemas";
import { validateCalendar } from "./validation";

const AGENTS: AgentName[] = [
  "Deadline Agent",
  "Grade Agent",
  "Effort Agent",
  "Wellbeing Agent",
  "Risk Agent"
];

interface ResolvedRequest extends Required<Omit<PlanningRequest, "planningWindowOverride">> {
  planningWindowOverride?: PlanningRequest["planningWindowOverride"];
}

export function getPlannerDefaults(): PlannerDefaults {
  return {
    quorum: clampInteger(parseNumber(process.env.PLANNER_QUORUM, 3), 1, 5),
    maxIterations: clampInteger(parseNumber(process.env.PLANNER_MAX_ITERATIONS, 3), 1, 5),
    timezone: process.env.PLANNER_TIMEZONE?.trim() || "Europe/Lisbon",
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    defaultDailyAvailabilityHours: Math.max(0.5, parseNumber(process.env.PLANNER_DAILY_HOURS, 4)),
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY?.trim())
  };
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const BASE_SYSTEM_PROMPT = [
  "You are part of a multi-agent student calendar planner prototype.",
  "Return JSON only. Do not include markdown.",
  "Use concrete ISO date strings. Calendar blocks must have absolute ISO start and end datetimes.",
  "Preserve uncertainty instead of inventing fake precision."
].join(" ");

export async function runPlanningPipeline(
  request: PlanningRequest,
  onProgress: ProgressCallback = noopProgress
): Promise<PlanningResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in the .env file.");
  }

  const normalizedRequest = normalizeRequest(request);
  const createdAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  console.log(`[planner] run ${runId} starting · model=${normalizedRequest.model} · quorum=${normalizedRequest.quorum} · maxIter=${normalizedRequest.maxIterations}`);

  logAndEmit(onProgress, { phase: "interpreter", status: "start" });
  const interpreterOutput = await runInterpreter(apiKey, normalizedRequest);
  logAndEmit(onProgress, {
    phase: "interpreter",
    status: "done",
    summary: `${interpreterOutput.tasks.length} task(s), window ${interpreterOutput.planning_window.start_date} → ${interpreterOutput.planning_window.end_date}`
  });

  logAndEmit(onProgress, { phase: "specialist", status: "start", summary: `${AGENTS.length} agents in parallel` });
  const agentViews = await runSpecialists(apiKey, normalizedRequest, interpreterOutput, onProgress);
  logAndEmit(onProgress, { phase: "specialist", status: "done", summary: `${agentViews.length} perspectives gathered` });

  const calendarVersions: CalendarVersionRecord[] = [];

  logAndEmit(onProgress, { phase: "planner", status: "start", iteration: 1 });
  let calendar = await runPlanner(apiKey, normalizedRequest, interpreterOutput, agentViews, 1);
  logAndEmit(onProgress, { phase: "planner", status: "done", iteration: 1, summary: `${calendar.days?.length ?? 0} day(s) drafted` });

  let finalRecord: CalendarVersionRecord | null = null;
  let stopReason = "";

  for (let iteration = 0; iteration < normalizedRequest.maxIterations; iteration += 1) {
    const version = iteration + 1;
    calendar = normalizeCalendar(calendar, version, interpreterOutput, normalizedRequest);

    logAndEmit(onProgress, { phase: "critique", status: "start", iteration: version });
    const rawCritiques = await runCritiques(apiKey, normalizedRequest, interpreterOutput, agentViews, calendar);
    const critiques = normalizeCritiques(rawCritiques, calendar.calendar_version);
    const approvals = countApprovals(critiques);
    const hasCritical = hasCriticalCritique(critiques);
    logAndEmit(onProgress, {
      phase: "critique",
      status: "done",
      iteration: version,
      summary: `${approvals}/${AGENTS.length} approvals${hasCritical ? " · critical issues raised" : ""}`
    });

    const validation = validateCalendar(calendar, interpreterOutput);
    logAndEmit(onProgress, {
      phase: "validate",
      status: "done",
      iteration: version,
      summary: validation.valid ? "constraints ok" : `${validation.violations.length} violation(s)`
    });

    const record: CalendarVersionRecord = {
      calendar,
      critiques,
      validation,
      approvals,
      hasCritical
    };
    calendarVersions.push(record);

    if (validation.valid && !hasCritical && approvals >= normalizedRequest.quorum) {
      finalRecord = record;
      stopReason = `Accepted by ${approvals}/${AGENTS.length} agents with no critical critiques.`;
      logAndEmit(onProgress, { phase: "decision", status: "done", iteration: version, summary: stopReason });
      break;
    }

    if (iteration < normalizedRequest.maxIterations - 1) {
      logAndEmit(onProgress, { phase: "planner", status: "start", iteration: version + 1, summary: "revising based on critiques" });
      calendar = await runPlanner(
        apiKey,
        normalizedRequest,
        interpreterOutput,
        agentViews,
        version + 1,
        calendar,
        critiques,
        validation
      );
      logAndEmit(onProgress, { phase: "planner", status: "done", iteration: version + 1, summary: `${calendar.days?.length ?? 0} day(s) drafted` });
    }
  }

  if (!finalRecord) {
    finalRecord = chooseBestCalendarVersion(calendarVersions);
    stopReason = "Maximum iterations reached. Selected best available calendar.";
    logAndEmit(onProgress, { phase: "decision", status: "done", summary: stopReason });
  }

  const resultWithoutExports = {
    runId,
    createdAt,
    request: normalizedRequest,
    stopReason,
    interpreterOutput,
    agentViews,
    calendarVersions,
    finalCalendar: finalRecord.calendar,
    critiques: finalRecord.critiques,
    validation: finalRecord.validation
  };

  const finalResult = {
    ...resultWithoutExports,
    exports: {
      json: createJsonExport(resultWithoutExports),
      ics: createIcsExport(finalRecord.calendar)
    }
  };

  logAndEmit(onProgress, { phase: "complete", status: "done", summary: stopReason });
  return finalResult;
}

async function runInterpreter(apiKey: string, request: ResolvedRequest): Promise<InterpreterOutput> {
  const current = new Date();
  const user = [
    `Current datetime: ${current.toISOString()}`,
    `Timezone: ${request.timezone}`,
    `Default daily availability: ${request.defaultDailyAvailabilityHours} hours`,
    request.planningWindowOverride?.startDate || request.planningWindowOverride?.endDate
      ? `Planning window override: ${JSON.stringify(request.planningWindowOverride)}`
      : "Planning window override: none",
    "",
    "Student input:",
    request.userInput,
    "",
    "Infer tasks, deadlines, planning window, availability, fixed commitments, student state, and assumptions."
  ].join("\n");

  const output = await callOpenRouterJson<InterpreterOutput>({
    apiKey,
    model: request.model,
    system: BASE_SYSTEM_PROMPT,
    user,
    schemaName: "interpreter_output",
    schema: interpreterSchema
  });

  return normalizeInterpreter(output, request, current);
}

async function runSpecialists(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  onProgress: ProgressCallback = noopProgress
): Promise<SpecialistAgentView[]> {
  return Promise.all(
    AGENTS.map(async (agent) => {
      logAndEmit(onProgress, { phase: "specialist", status: "start", agent });
      const user = [
        `Agent: ${agent}`,
        `Quorum requirement: ${request.quorum}`,
        "Create your own independent interpretation of every task from your perspective.",
        "Do not flatten your perspective into a single score.",
        "",
        `Student input:\n${request.userInput}`,
        "",
        `Interpreter output:\n${JSON.stringify(interpreterOutput, null, 2)}`
      ].join("\n");

      const output = await callOpenRouterJson<SpecialistAgentView>({
        apiKey,
        model: request.model,
        system: `${BASE_SYSTEM_PROMPT} You are the ${agent}.`,
        user,
        schemaName: "specialist_agent_view",
        schema: specialistSchema
      });

      const view = normalizeSpecialist(output, agent, interpreterOutput);
      logAndEmit(onProgress, { phase: "specialist", status: "done", agent });
      return view;
    })
  );
}

async function runPlanner(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  agentViews: SpecialistAgentView[],
  version: number,
  previousCalendar?: CalendarProposal,
  critiques?: AgentCritique[],
  validation?: ReturnType<typeof validateCalendar>
): Promise<CalendarProposal> {
  const user = [
    `Create calendar version ${version}.`,
    `Required quorum: ${request.quorum}`,
    `Timezone: ${request.timezone}`,
    "Each block must include id, task_id when applicable, task_name when applicable, type, ISO start, ISO end, duration_hours, description, and reasoning.",
    "Respect the planning window, deadlines, daily available hours, and fixed commitments.",
    "Include compromise reasoning so specialist agents can critique the actual tradeoffs.",
    previousCalendar
      ? `Previous calendar:\n${JSON.stringify(previousCalendar, null, 2)}`
      : "No previous calendar.",
    critiques ? `Previous critiques:\n${JSON.stringify(critiques, null, 2)}` : "No previous critiques.",
    validation ? `Previous constraint validation:\n${JSON.stringify(validation, null, 2)}` : "No previous validation.",
    "",
    `Student input:\n${request.userInput}`,
    "",
    `Interpreter output:\n${JSON.stringify(interpreterOutput, null, 2)}`,
    "",
    `Specialist views:\n${JSON.stringify(agentViews, null, 2)}`
  ].join("\n");

  return callOpenRouterJson<CalendarProposal>({
    apiKey,
    model: request.model,
    system: `${BASE_SYSTEM_PROMPT} You are the Planner-Arbiter Agent.`,
    user,
    schemaName: "calendar_proposal",
    schema: calendarSchema
  });
}

async function runCritiques(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  agentViews: SpecialistAgentView[],
  calendar: CalendarProposal
): Promise<AgentCritique[]> {
  const user = [
    "Every specialist agent must critique the calendar from its own perspective.",
    "Return exactly one critique for each of: Deadline Agent, Grade Agent, Effort Agent, Wellbeing Agent, Risk Agent.",
    "Approval values: approve, approve_with_minor_concerns, reject.",
    "Severity values: none, minor, major, critical.",
    "A critical critique blocks acceptance. approve and approve_with_minor_concerns count toward quorum.",
    `Required quorum: ${request.quorum}`,
    "",
    `Interpreter output:\n${JSON.stringify(interpreterOutput, null, 2)}`,
    "",
    `Specialist views:\n${JSON.stringify(agentViews, null, 2)}`,
    "",
    `Calendar to critique:\n${JSON.stringify(calendar, null, 2)}`
  ].join("\n");

  const bundle = await callOpenRouterJson<{ critiques: AgentCritique[] }>({
    apiKey,
    model: request.model,
    system: `${BASE_SYSTEM_PROMPT} You are running the specialist critique round.`,
    user,
    schemaName: "critique_bundle",
    schema: critiqueBundleSchema
  });

  return bundle.critiques ?? [];
}

function normalizeRequest(request: PlanningRequest): ResolvedRequest {
  const defaults = getPlannerDefaults();
  return {
    userInput: request.userInput.trim(),
    quorum: clampInteger(request.quorum ?? defaults.quorum, 1, AGENTS.length),
    maxIterations: clampInteger(request.maxIterations ?? defaults.maxIterations, 1, 5),
    timezone: request.timezone?.trim() || defaults.timezone,
    model: request.model?.trim() || defaults.model,
    defaultDailyAvailabilityHours: Math.max(
      0.5,
      request.defaultDailyAvailabilityHours || defaults.defaultDailyAvailabilityHours
    ),
    planningWindowOverride: request.planningWindowOverride
  };
}

function normalizeInterpreter(
  output: InterpreterOutput,
  request: ResolvedRequest,
  current: Date
): InterpreterOutput {
  const currentDate = output.current_date || toIsoDate(current);
  const startDate = request.planningWindowOverride?.startDate || output.planning_window?.start_date || toIsoDate(current);
  const endDate =
    request.planningWindowOverride?.endDate ||
    output.planning_window?.end_date ||
    addDaysIso(startDate, 7);

  return {
    current_date: currentDate,
    planning_window: {
      start_date: startDate,
      end_date: endDate,
      reason: output.planning_window?.reason || "Inferred by the Interpreter Agent."
    },
    inferred_availability: ensureArray(output.inferred_availability).length
      ? output.inferred_availability
      : [
          {
            date_range: `${startDate} to ${endDate}`,
            assumption: "Default daily availability was used because no explicit availability was inferred.",
            estimated_available_hours_per_day: request.defaultDailyAvailabilityHours,
            confidence: "low"
          }
        ],
    fixed_commitments: ensureArray(output.fixed_commitments),
    student_state: {
      sleep: output.student_state?.sleep || "not specified",
      energy: output.student_state?.energy || "not specified",
      confidence: output.student_state?.confidence || "low"
    },
    tasks: ensureArray(output.tasks).map((task, index) => ({
      task_id: task.task_id || `T${index + 1}`,
      name: task.name || `Task ${index + 1}`,
      raw_mentions: ensureArray(task.raw_mentions),
      inferred_deadline: task.inferred_deadline,
      uncertainties: ensureArray(task.uncertainties)
    })),
    assumptions: ensureArray(output.assumptions)
  };
}

function normalizeSpecialist(
  output: SpecialistAgentView,
  agent: AgentName,
  interpreterOutput: InterpreterOutput
): SpecialistAgentView {
  const views = ensureArray(output.task_views);
  return {
    agent,
    task_views: interpreterOutput.tasks.map((task) => {
      const view = views.find((candidate) => candidate.task_id === task.task_id);
      return {
        task_id: task.task_id,
        task_name: task.name,
        assessment: view?.assessment || "No detailed assessment returned.",
        concerns: ensureArray(view?.concerns),
        recommendations: ensureArray(view?.recommendations),
        estimated_duration_hours: view?.estimated_duration_hours,
        confidence: view?.confidence,
        suggested_subtasks: ensureArray(view?.suggested_subtasks)
      };
    }),
    overall_comment: output.overall_comment || `${agent} completed its interpretation.`
  };
}

function normalizeCalendar(
  calendar: CalendarProposal,
  version: number,
  interpreterOutput: InterpreterOutput,
  request: ResolvedRequest
): CalendarProposal {
  return {
    calendar_version: version,
    planning_window: calendar.planning_window || interpreterOutput.planning_window,
    overall_strategy: ensureArray(calendar.overall_strategy),
    days: ensureArray(calendar.days).map((day) => ({
      date: day.date,
      day_name: day.day_name || day.date,
      assumed_available_hours: day.assumed_available_hours || request.defaultDailyAvailabilityHours,
      day_reasoning: day.day_reasoning || "No day reasoning returned.",
      blocks: ensureArray(day.blocks).map((block, index) => ({
        ...block,
        id: block.id || `v${version}-${day.date}-${index + 1}`,
        type: block.type || (block.task_id ? "work" : "buffer"),
        duration_hours: block.duration_hours || durationHours(block.start, block.end),
        description: block.description || block.task_name || "Planned block",
        reasoning: block.reasoning || "No block reasoning returned."
      }))
    })),
    compromises: ensureArray(calendar.compromises),
    known_weaknesses: ensureArray(calendar.known_weaknesses),
    changes_from_previous: ensureArray(calendar.changes_from_previous),
    unresolved_critiques: ensureArray(calendar.unresolved_critiques)
  };
}

function normalizeCritiques(critiques: AgentCritique[], version: number): AgentCritique[] {
  return AGENTS.map((agent) => {
    const critique = critiques.find((candidate) => candidate.agent === agent);
    return {
      agent,
      calendar_version: version,
      approval: normalizeApproval(critique?.approval),
      severity: normalizeSeverity(critique?.severity),
      critiques: ensureArray(critique?.critiques).map((issue) => ({
        issue: issue.issue || "No issue text returned.",
        severity: normalizeSeverity(issue.severity),
        affected_tasks: ensureArray(issue.affected_tasks),
        affected_days: ensureArray(issue.affected_days),
        suggested_fix: issue.suggested_fix || "No suggested fix returned."
      })),
      acknowledged_compromises: ensureArray(critique?.acknowledged_compromises),
      overall_comment: critique?.overall_comment || `${agent} did not return a detailed critique.`
    };
  });
}

function normalizeApproval(value: unknown): AgentCritique["approval"] {
  return value === "approve" || value === "approve_with_minor_concerns" || value === "reject" ? value : "reject";
}

function normalizeSeverity(value: unknown): AgentCritique["severity"] {
  return value === "none" || value === "minor" || value === "major" || value === "critical" ? value : "major";
}

function ensureArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

function durationHours(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 1;
  }
  return Math.max(0.25, (endDate.getTime() - startDate.getTime()) / 3_600_000);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(start: string, days: number): string {
  const date = new Date(start);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}
