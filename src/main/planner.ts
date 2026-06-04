import crypto from "node:crypto";
import type {
  AgentCritique,
  AgentName,
  CalendarProposal,
  CalendarVersionRecord,
  InterpreterOutput,
  LlmCallTrace,
  PlannerDefaults,
  PlanningUsageSummary,
  PlanningRequest,
  PlanningResult,
  ProgressEvent,
  ScheduleEvaluation,
  SpecialistAgentView
} from "../shared/types";

export type ProgressCallback = (event: Omit<ProgressEvent, "timestamp">) => void;

function noopProgress(): void {
  /* noop */
}

function noopTrace(): void {
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
import { loadConfig } from "./config";
import { saveRunLog } from "./debug";
import { createIcsExport, createJsonExport } from "./exports";
import { saveCalendar } from "./storage";
import { countApprovals, chooseBestCalendarVersion, hasCriticalCritique } from "./logic";
import { evaluateHardMetrics } from "./metrics";
import { callOpenRouterJson } from "./openrouter";
import { AGENT_NAMES, AGENT_PROMPTS, BASE_SYSTEM_PROMPT, SCHEDULE_EVALUATOR_PROMPT } from "./prompts";
import { calendarSchema, critiqueSchema, interpreterSchema, scheduleEvaluationSchema, specialistSchema } from "./schemas";
import { validateCalendar } from "./validation";

interface ResolvedRequest extends Required<Omit<PlanningRequest, "planningWindowOverride">> {
  planningWindowOverride?: PlanningRequest["planningWindowOverride"];
}

function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function getPlannerDefaults(): PlannerDefaults {
  const config = loadConfig();
  const model = config.model;
  return {
    quorum: clampInteger(config.quorum, 1, 5),
    maxIterations: clampInteger(config.maxIterations ?? 3, 1, 5),
    timezone: systemTimezone(),
    model,
    evaluatorModel: model,
    hasApiKey: Boolean(config.apiKey?.trim())
  };
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}



export async function runPlanningPipeline(
  request: PlanningRequest,
  onProgress: ProgressCallback = noopProgress,
  signal?: AbortSignal
): Promise<PlanningResult> {
  const config = loadConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("Missing OpenRouter API key. Set it in Settings.");
  }

  const normalizedRequest = normalizeRequest(request);
  const createdAt = new Date().toISOString();
  const runStartedAt = Date.now();
  const runId = crypto.randomUUID();
  const llmCalls: LlmCallTrace[] = [];
  const onTrace = (trace: LlmCallTrace) => llmCalls.push(trace);
  console.log(
    `[planner] run ${runId} starting · plannerModel=${normalizedRequest.model} · evaluatorModel=${normalizedRequest.evaluatorModel} · quorum=${normalizedRequest.quorum} · maxIter=${normalizedRequest.maxIterations}`
  );

  logAndEmit(onProgress, { phase: "interpreter", status: "start" });
  throwIfCancelled(signal);
  const interpreterOutput = await runInterpreter(apiKey, normalizedRequest, onTrace, signal);
  logAndEmit(onProgress, {
    phase: "interpreter",
    status: "done",
    summary: `${interpreterOutput.tasks.length} task(s), window ${formatWindow(interpreterOutput.planning_window.start_date, interpreterOutput.planning_window.end_date)}`
  });

  logAndEmit(onProgress, { phase: "specialist", status: "start", summary: `${AGENT_NAMES.length} agents in parallel` });
  throwIfCancelled(signal);
  const agentViews = await runSpecialists(apiKey, normalizedRequest, interpreterOutput, onProgress, onTrace, signal);
  logAndEmit(onProgress, { phase: "specialist", status: "done", summary: `${agentViews.length} perspectives gathered` });

  const calendarVersions: CalendarVersionRecord[] = [];

  logAndEmit(onProgress, { phase: "planner", status: "start", iteration: 1 });
  throwIfCancelled(signal);
  let calendar = await runPlanner(apiKey, normalizedRequest, interpreterOutput, agentViews, 1, undefined, undefined, onTrace, signal);
  logAndEmit(onProgress, { phase: "planner", status: "done", iteration: 1, summary: `${calendar.days?.length ?? 0} day(s) drafted` });

  let finalRecord: CalendarVersionRecord | null = null;
  let stopReason = "";

  for (let iteration = 0; iteration < normalizedRequest.maxIterations; iteration += 1) {
    const version = iteration + 1;
    calendar = normalizeCalendar(calendar, version);

    throwIfCancelled(signal);
    const rawCritiques = await runCritiques(
      apiKey,
      normalizedRequest,
      interpreterOutput,
      agentViews,
      calendar,
      onProgress,
      onTrace,
      signal
    );
    const critiques = normalizeCritiques(rawCritiques, calendar.calendar_version);
    const approvals = countApprovals(critiques);
    const hasCritical = hasCriticalCritique(critiques);
    console.log(`[planner] critique v${version} summary — ${approvals}/${AGENT_NAMES.length} approvals${hasCritical ? " · critical issues raised" : ""}`);

    const validation = validateCalendar(calendar, interpreterOutput);
    logAndEmit(onProgress, {
      phase: "validate",
      status: "done",
      iteration: version,
      summary: validation.valid ? "constraints ok" : `${validation.violations.length} logged issue(s)`
    });

    const record: CalendarVersionRecord = {
      calendar,
      critiques,
      validation,
      approvals,
      hasCritical
    };
    calendarVersions.push(record);

    if (!hasCritical && approvals >= normalizedRequest.quorum) {
      finalRecord = record;
      stopReason = `Accepted by ${approvals}/${AGENT_NAMES.length} agents with no critical critiques.`;
      logAndEmit(onProgress, { phase: "decision", status: "done", iteration: version, summary: stopReason });
      break;
    }

    if (iteration < normalizedRequest.maxIterations - 1) {
      logAndEmit(onProgress, { phase: "planner", status: "start", iteration: version + 1, summary: "revising based on critiques" });
      throwIfCancelled(signal);
      calendar = await runPlanner(
        apiKey,
        normalizedRequest,
        interpreterOutput,
        agentViews,
        version + 1,
        calendar,
        critiques,
        onTrace,
        signal
      );
      logAndEmit(onProgress, { phase: "planner", status: "done", iteration: version + 1, summary: `${calendar.days?.length ?? 0} day(s) drafted` });
    }
  }

  if (!finalRecord) {
    finalRecord = chooseBestCalendarVersion(calendarVersions);
    stopReason = "Maximum iterations reached. Selected best available calendar.";
    logAndEmit(onProgress, { phase: "decision", status: "done", summary: stopReason });
  }

  const generationTimeSeconds = (Date.now() - runStartedAt) / 1000;
  const hardMetrics = evaluateHardMetrics({
    calendar: finalRecord.calendar,
    critiques: finalRecord.critiques,
    validation: finalRecord.validation,
    interpreterOutput,
    generationTimeSeconds
  });

  logAndEmit(onProgress, {
    phase: "evaluate",
    status: "start",
    iteration: finalRecord.calendar.calendar_version,
    summary: `scoring final calendar with ${normalizedRequest.evaluatorModel}`
  });
  throwIfCancelled(signal);
  const evaluation = await runScheduleEvaluator(
    apiKey,
    normalizedRequest,
    interpreterOutput,
    agentViews,
    finalRecord,
    hardMetrics,
    stopReason,
    onTrace,
    signal
  );
  logAndEmit(onProgress, {
    phase: "evaluate",
    status: "done",
    iteration: finalRecord.calendar.calendar_version,
    summary: `overall ${evaluation.overall_score.toFixed(1)}/5`
  });

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
    validation: finalRecord.validation,
    evaluation,
    usage: summarizeUsage(llmCalls)
  };

  const finalResult = {
    ...resultWithoutExports,
    exports: {
      json: createJsonExport(resultWithoutExports),
      ics: createIcsExport(finalRecord.calendar)
    }
  };

  logAndEmit(onProgress, { phase: "complete", status: "done", summary: stopReason });

  try {
    saveRunLog(finalResult);
    saveCalendar(
      `Plan ${formatWindow(finalResult.finalCalendar.planning_window.start_date, finalResult.finalCalendar.planning_window.end_date)}`,
      finalResult
    );
  } catch (err) {
    console.error("[debug] failed to save run log or calendar:", err);
  }

  return finalResult;
}

async function runInterpreter(
  apiKey: string,
  request: ResolvedRequest,
  onTrace: (trace: LlmCallTrace) => void = noopTrace,
  signal?: AbortSignal
): Promise<InterpreterOutput> {
  const current = new Date();
  const user = [
    `Current datetime: ${current.toISOString()}`,
    `Timezone: ${request.timezone}`,
    request.planningWindowOverride?.startDate || request.planningWindowOverride?.endDate
      ? `Planning window override: ${JSON.stringify(request.planningWindowOverride)}`
      : "Planning window override: none",
    "",
    "Student input:",
    request.userInput,
    "",
    "Infer tasks, deadlines, planning window, availability, fixed commitments, student state, and assumptions.",
    "Infer daily availability from context (classes, work, energy levels, sleep). Do not assume a generic default.",
    schemaInstruction("interpreter_output", interpreterSchema),
    "If the input contains named assignments, quizzes, exams, labs, proposals, presentations, chores, or study work, create at least one task per named item."
  ].join("\n");

  const output = await callOpenRouterJson<InterpreterOutput>({
    apiKey,
    model: request.model,
    system: BASE_SYSTEM_PROMPT,
    user,
    schemaName: "interpreter_output",
    schema: interpreterSchema,
    signal,
    onTrace,
    maxCompletionTokens: 12_000,
    timeoutMs: 120_000
  });

  return normalizeInterpreter(output, request);
}

async function runSpecialists(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  onProgress: ProgressCallback = noopProgress,
  onTrace: (trace: LlmCallTrace) => void = noopTrace,
  signal?: AbortSignal
): Promise<SpecialistAgentView[]> {
  return Promise.all(
    AGENT_NAMES.map(async (agent) => {
      throwIfCancelled(signal);
      logAndEmit(onProgress, { phase: "specialist", status: "start", agent });
      const user = [
        `Agent: ${agent}`,
        `Specialist responsibility: ${AGENT_PROMPTS[agent]}`,
        `Quorum requirement: ${request.quorum}`,
        "Create your own independent interpretation of every task from your perspective.",
        "Do not flatten your perspective into a single score.",
        "Return one task_view for every task_id from the interpreter output.",
        schemaInstruction("specialist_agent_view", specialistSchema),
        "",
        `Student input:\n${request.userInput}`,
        "",
        `Interpreter output:\n${JSON.stringify(compactInterpreter(interpreterOutput), null, 2)}`
      ].join("\n");

      const output = await callOpenRouterJson<SpecialistAgentView>({
        apiKey,
        model: request.model,
        system: `${BASE_SYSTEM_PROMPT} You are the ${agent}. ${AGENT_PROMPTS[agent]}`,
        user,
        schemaName: "specialist_agent_view",
        schema: specialistSchema,
        signal,
        onTrace,
        maxCompletionTokens: 16_000,
        timeoutMs: 150_000
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
  onTrace?: (trace: LlmCallTrace) => void,
  signal?: AbortSignal
): Promise<CalendarProposal> {
  const user = version === 1
    ? buildInitialPlannerPrompt(request, interpreterOutput, agentViews)
    : buildRevisionPlannerPrompt(request, interpreterOutput, previousCalendar!, critiques!);

  return callOpenRouterJson<CalendarProposal>({
    apiKey,
    model: request.model,
    system: `${BASE_SYSTEM_PROMPT} You are the Planner-Arbiter Agent.`,
    user,
    schemaName: "calendar_proposal",
    schema: calendarSchema,
    signal,
    onTrace,
    maxCompletionTokens: 24_000,
    timeoutMs: 180_000
  });
}

async function runCritiques(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  agentViews: SpecialistAgentView[],
  calendar: CalendarProposal,
  onProgress: ProgressCallback = noopProgress,
  onTrace: (trace: LlmCallTrace) => void = noopTrace,
  signal?: AbortSignal
): Promise<AgentCritique[]> {
  return Promise.all(
    AGENT_NAMES.map(async (agent) => {
      throwIfCancelled(signal);
      logAndEmit(onProgress, {
        phase: "critique",
        status: "start",
        iteration: calendar.calendar_version,
        agent
      });

      const ownView = agentViews.find((v) => v.agent === agent);
      const user = [
        `You are the ${agent}. Critique the calendar from your own perspective only.`,
        `Specialist responsibility: ${AGENT_PROMPTS[agent]}`,
        "Approval values: approve, approve_with_minor_concerns, reject.",
        "Severity values: none, minor, major, critical.",
        "A critical critique blocks acceptance. approve and approve_with_minor_concerns count toward quorum.",
        "If you reject, include concrete affected_tasks, affected_days, and suggested_fix.",
        "If the planner addressed your earlier concerns, acknowledge that compromise instead of repeating the same objection.",
        schemaInstruction("agent_critique", critiqueSchema),
        `Required quorum: ${request.quorum}`,
        "",
        `Interpreter output:\n${JSON.stringify(compactInterpreter(interpreterOutput), null, 2)}`,
        "",
        `Your earlier view:\n${JSON.stringify(ownView ?? {}, null, 2)}`,
        "",
        `Calendar to critique:\n${JSON.stringify(compactCalendar(calendar), null, 2)}`
      ].join("\n");

      const critique = await callOpenRouterJson<AgentCritique>({
        apiKey,
        model: request.model,
        system: `${BASE_SYSTEM_PROMPT} You are the ${agent} performing a critique round. ${AGENT_PROMPTS[agent]}`,
        user,
        schemaName: "agent_critique",
        schema: critiqueSchema,
        signal,
        onTrace,
        maxCompletionTokens: 12_000,
        timeoutMs: 120_000
      });

      const normalized: AgentCritique = { ...critique, agent };
      logAndEmit(onProgress, {
        phase: "critique",
        status: "done",
        iteration: calendar.calendar_version,
        agent,
        summary: critique.approval ?? "no approval returned"
      });
      return normalized;
    })
  );
}

async function runScheduleEvaluator(
  apiKey: string,
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  agentViews: SpecialistAgentView[],
  finalRecord: CalendarVersionRecord,
  hardMetrics: ScheduleEvaluation["hard_metrics"],
  stopReason: string,
  onTrace: (trace: LlmCallTrace) => void,
  signal?: AbortSignal
): Promise<ScheduleEvaluation> {
  const user = [
    "Evaluate the selected final schedule for comparison across planner models.",
    "Return exactly one score for each required dimension.",
    "Scores are numeric from 1 to 5. Use decimals only when the distinction matters.",
    "Hard metrics are already computed separately. Do not re-score objective counts such as rejections, critical issues, deadline violations, task coverage, availability overrun, or generation speed.",
    "Focus your model judgement on qualitative schedule quality: coherence, usefulness, prioritization, compromise reasoning, clarity, actionability, and handling of uncertainty.",
    "This evaluation is diagnostic only and must not change calendar acceptance.",
    schemaInstruction("schedule_evaluation", scheduleEvaluationSchema),
    "",
    `Planner model: ${request.model}`,
    `Evaluator model: ${request.evaluatorModel}`,
    `Quorum requirement: ${request.quorum}`,
    `Stop reason: ${stopReason}`,
    "",
    `Student input:\n${request.userInput}`,
    "",
    `Interpreter output:\n${JSON.stringify(compactInterpreter(interpreterOutput), null, 2)}`,
    "",
    `Specialist views:\n${JSON.stringify(compactAgentViews(agentViews), null, 2)}`,
    "",
    `Final calendar:\n${JSON.stringify(compactCalendar(finalRecord.calendar), null, 2)}`,
    "",
    `Final critiques:\n${JSON.stringify(finalRecord.critiques, null, 2)}`,
    "",
    `Validation log:\n${JSON.stringify(finalRecord.validation, null, 2)}`,
    "",
    `Hard metrics for reference:\n${JSON.stringify(hardMetrics, null, 2)}`
  ].join("\n");

  const output = await callOpenRouterJson<ScheduleEvaluation>({
    apiKey,
    model: request.evaluatorModel,
    system: `${BASE_SYSTEM_PROMPT} ${SCHEDULE_EVALUATOR_PROMPT}`,
    user,
    schemaName: "schedule_evaluation",
    schema: scheduleEvaluationSchema,
    signal,
    onTrace,
    maxCompletionTokens: 8_000,
    timeoutMs: 120_000
  });

  return normalizeEvaluation(output, finalRecord.calendar.calendar_version, request, hardMetrics);
}

function normalizeRequest(request: PlanningRequest): ResolvedRequest {
  const defaults = getPlannerDefaults();
  const model = request.model?.trim() || defaults.model;
  return {
    userInput: request.userInput.trim(),
    quorum: clampInteger(request.quorum ?? defaults.quorum, 1, AGENT_NAMES.length),
    maxIterations: clampInteger(request.maxIterations ?? defaults.maxIterations, 1, 5),
    timezone: request.timezone?.trim() || defaults.timezone,
    model,
    evaluatorModel: model,
    planningWindowOverride: request.planningWindowOverride
  };
}

function summarizeUsage(calls: LlmCallTrace[]): PlanningUsageSummary {
  const estimatedCosts = calls
    .map((call) => call.estimatedCostUsd)
    .filter((cost): cost is number => typeof cost === "number");
  const allCostsKnown = estimatedCosts.length === calls.length;

  return {
    callCount: calls.length,
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    totalTokens: calls.reduce((sum, call) => sum + call.totalTokens, 0),
    estimatedCostUsd: allCostsKnown
      ? Math.round(estimatedCosts.reduce((sum, cost) => sum + cost, 0) * 1_000_000) / 1_000_000
      : null,
    calls
  };
}

function normalizeInterpreter(
  output: InterpreterOutput,
  request: ResolvedRequest
): InterpreterOutput {
  const startDate = request.planningWindowOverride?.startDate ?? output.planning_window.start_date;
  const endDate = request.planningWindowOverride?.endDate ?? output.planning_window.end_date;

  return {
    current_date: output.current_date,
    planning_window: {
      start_date: startDate,
      end_date: endDate,
      reason: output.planning_window.reason
    },
    inferred_availability: output.inferred_availability,
    fixed_commitments: output.fixed_commitments,
    student_state: output.student_state,
    tasks: output.tasks.map((task) => ({
      task_id: task.task_id,
      name: task.name,
      raw_mentions: task.raw_mentions,
      inferred_deadline: task.inferred_deadline,
      uncertainties: task.uncertainties
    })),
    assumptions: output.assumptions
  };
}

function normalizeSpecialist(
  output: SpecialistAgentView,
  agent: AgentName,
  interpreterOutput: InterpreterOutput
): SpecialistAgentView {
  if (output.agent !== agent) {
    throw new Error(`Specialist schema violation: expected ${agent}, received ${output.agent}.`);
  }

  return {
    agent,
    task_views: interpreterOutput.tasks.map((task) => {
      const view = output.task_views.find((candidate) => candidate.task_id === task.task_id);
      if (!view) {
        throw new Error(`Specialist schema violation: ${agent} omitted task view for ${task.task_id}.`);
      }
      return {
        task_id: task.task_id,
        task_name: task.name,
        assessment: view.assessment,
        concerns: view.concerns,
        recommendations: view.recommendations,
        estimated_duration_hours: view.estimated_duration_hours,
        confidence: view.confidence,
        suggested_subtasks: view.suggested_subtasks
      };
    }),
    overall_comment: output.overall_comment
  };
}

function normalizeCalendar(calendar: CalendarProposal, version: number): CalendarProposal {
  return {
    calendar_version: version,
    planning_window: calendar.planning_window,
    overall_strategy: calendar.overall_strategy,
    days: calendar.days.map((day) => ({
      date: day.date,
      day_name: day.day_name,
      assumed_available_hours: day.assumed_available_hours,
      day_reasoning: day.day_reasoning,
      blocks: day.blocks
    })),
    compromises: calendar.compromises,
    known_weaknesses: calendar.known_weaknesses,
    changes_from_previous: calendar.changes_from_previous,
    unresolved_critiques: calendar.unresolved_critiques
  };
}

function normalizeCritiques(critiques: AgentCritique[], version: number): AgentCritique[] {
  return AGENT_NAMES.map((agent) => {
    const critique = critiques.find((candidate) => candidate.agent === agent);
    if (!critique) {
      throw new Error(`Critique schema violation: missing critique for ${agent}.`);
    }
    return {
      agent,
      calendar_version: version,
      approval: critique.approval,
      severity: critique.severity,
      critiques: critique.critiques,
      acknowledged_compromises: critique.acknowledged_compromises,
      overall_comment: critique.overall_comment
    };
  });
}

function normalizeEvaluation(
  evaluation: ScheduleEvaluation,
  version: number,
  request: ResolvedRequest,
  hardMetrics: ScheduleEvaluation["hard_metrics"]
): ScheduleEvaluation {
  const requiredDimensions: ScheduleEvaluation["dimension_scores"][number]["dimension"][] = [
    "requirement_match",
    "deadline_safety",
    "workload_realism",
    "academic_priority",
    "wellbeing_balance",
    "risk_resilience"
  ];

  const modelScore = clampScore(evaluation.overall_score);
  const hardScoreAsFive = round1(1 + (hardMetrics.score / 100) * 4);
  const combinedScore = round1(modelScore * 0.5 + hardScoreAsFive * 0.5);

  return {
    evaluator: "Schedule Evaluator",
    calendar_version: version,
    planner_model: request.model,
    evaluator_model: request.evaluatorModel,
    overall_score: combinedScore,
    model_score: modelScore,
    hard_score: hardScoreAsFive,
    hard_metrics: hardMetrics,
    dimension_scores: requiredDimensions.map((dimension) => {
      const score = evaluation.dimension_scores.find((entry) => entry.dimension === dimension);
      if (!score) {
        throw new Error(`Schedule evaluator omitted dimension ${dimension}.`);
      }
      return {
        dimension,
        score: clampScore(score.score),
        rationale: score.rationale
      };
    }),
    strengths: evaluation.strengths,
    weaknesses: evaluation.weaknesses,
    comparison_notes: evaluation.comparison_notes,
    recommendation: evaluation.recommendation
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

function clampScore(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(5, Math.max(1, Math.round(parsed * 10) / 10));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Planner run cancelled.");
  }
}

function schemaInstruction(name: string, schema: Record<string, unknown>): string {
  return [
    `Output contract for ${name}:`,
    JSON.stringify(schema),
    "Do not omit required-looking top-level keys. Use empty arrays instead of missing arrays. Use null only if the schema allows null."
  ].join("\n");
}

function buildInitialPlannerPrompt(
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  agentViews: SpecialistAgentView[]
): string {
  return [
    `Create calendar version 1.`,
    `Required quorum: ${request.quorum}`,
    `Timezone: ${request.timezone}`,
    "Each block must include id, task_id, task_name, type, ISO start, ISO end, duration_hours, description, and reasoning.",
    "Every work block MUST reference a real task_id from the interpreter output. Do not invent tasks.",
    "USER-FACING TEXT (description, reasoning, overall_strategy, compromises, known_weaknesses, day_reasoning): NEVER use raw task IDs like T1, T2, T3 — the user does not know what those mean. Always use the task's human name (e.g. 'AASMA proposal', 'DB lab') instead.",
    "Do NOT create buffer, break, or rest blocks. Unscheduled time in the calendar IS rest time by default. Only create work blocks for actual tasks from the interpreter output.",
    "Do NOT create generic lifestyle blocks such as 'morning classes', 'dinner', 'decompression', 'commute', 'sleep', 'general buffer time', 'contingency buffer', or similar. Only create blocks for actual tasks from the interpreter output.",
    "For each day, set assumed_available_hours realistically based on the inferred availability. The sum of ALL block durations on that day MUST NOT exceed assumed_available_hours.",
    "Respect the planning window, deadlines, and fixed commitments.",
    "Include compromise reasoning so specialist agents can critique the actual tradeoffs.",
    "Keep all prose fields concise: one short sentence per description, reasoning, compromise, weakness, and strategy item.",
    "Create a usable calendar. If tasks exist, days must not be empty.",
    "Prefer afternoon blocks when availability says morning classes. Keep blocks between 07:00 and 23:00 local time unless the user explicitly says otherwise.",
    "Initial draft priority: schedule all inferred tasks before deadlines, and balance daily workload. Do NOT add buffer or break blocks — unscheduled time is implicitly rest.",
    schemaInstruction("calendar_proposal", calendarSchema),
    "",
    `Student input:\n${request.userInput}`,
    "",
    `Interpreter output:\n${JSON.stringify(compactInterpreter(interpreterOutput), null, 2)}`,
    "",
    `Specialist views:\n${JSON.stringify(compactAgentViews(agentViews), null, 2)}`
  ].join("\n");
}

function buildRevisionPlannerPrompt(
  request: ResolvedRequest,
  interpreterOutput: InterpreterOutput,
  previousCalendar: CalendarProposal,
  critiques: AgentCritique[]
): string {
  return [
    `Create revised calendar version ${previousCalendar.calendar_version + 1}.`,
    `Required quorum: ${request.quorum}`,
    `Timezone: ${request.timezone}`,
    "Each block must include id, task_id, task_name, type, ISO start, ISO end, duration_hours, description, and reasoning.",
    "Every work block MUST reference a real task_id from the interpreter output. Do not invent tasks.",
    "USER-FACING TEXT (description, reasoning, overall_strategy, compromises, known_weaknesses, day_reasoning): NEVER use raw task IDs like T1, T2, T3 — the user does not know what those mean. Always use the task's human name (e.g. 'AASMA proposal', 'DB lab') instead.",
    "Do NOT create buffer, break, or rest blocks. Unscheduled time in the calendar IS rest time by default. Only create work blocks for actual tasks from the interpreter output.",
    "Do NOT create generic lifestyle blocks such as 'morning classes', 'dinner', 'decompression', 'commute', 'sleep', 'general buffer time', 'contingency buffer', or similar. Only create blocks for actual tasks from the interpreter output.",
    "For each day, set assumed_available_hours realistically. The sum of ALL block durations on that day MUST NOT exceed assumed_available_hours.",
    "Respect the planning window, deadlines, and fixed commitments.",
    "Include compromise reasoning so specialist agents can critique the actual tradeoffs.",
    "Keep all prose fields concise: one short sentence per description, reasoning, compromise, weakness, change, and planner_response.",
    "Revision priority: address critical critiques first, then rejected/major critiques, while preserving approved parts. Do NOT add buffer or break blocks — unscheduled time is implicitly rest.",
    schemaInstruction("calendar_proposal", calendarSchema),
    "",
    `Previous calendar:\n${JSON.stringify(compactCalendarForRevision(previousCalendar), null, 2)}`,
    "",
    `Critiques to address:\n${JSON.stringify(compactCritiquesForRevision(critiques), null, 2)}`,
    "",
    `Task list:\n${JSON.stringify(interpreterOutput.tasks.map((t) => ({ task_id: t.task_id, name: t.name, deadline: t.inferred_deadline })), null, 2)}`
  ].join("\n");
}

function compactInterpreter(output: InterpreterOutput) {
  return {
    current_date: output.current_date,
    planning_window: output.planning_window,
    availability: output.inferred_availability,
    fixed_commitments: output.fixed_commitments,
    student_state: output.student_state,
    tasks: output.tasks,
    assumptions: output.assumptions
  };
}

function compactAgentViews(agentViews: SpecialistAgentView[]) {
  return agentViews.map((view) => ({
    agent: view.agent,
    overall_comment: view.overall_comment,
    task_views: view.task_views.map((taskView) => ({
      task_id: taskView.task_id,
      task_name: taskView.task_name,
      assessment: taskView.assessment,
      estimated_duration_hours: taskView.estimated_duration_hours,
      concerns: taskView.concerns.slice(0, 3),
      recommendations: taskView.recommendations.slice(0, 3),
      suggested_subtasks: taskView.suggested_subtasks?.slice(0, 5)
    }))
  }));
}

function compactCalendar(calendar: CalendarProposal) {
  return {
    calendar_version: calendar.calendar_version,
    planning_window: calendar.planning_window,
    overall_strategy: calendar.overall_strategy,
    days: calendar.days.map((day) => ({
      date: day.date,
      assumed_available_hours: day.assumed_available_hours,
      blocks: day.blocks.map((block) => ({
        id: block.id,
        task_id: block.task_id,
        task_name: block.task_name,
        type: block.type,
        start: block.start,
        end: block.end,
        duration_hours: block.duration_hours,
        description: block.description,
        reasoning: block.reasoning
      }))
    })),
    compromises: calendar.compromises,
    known_weaknesses: calendar.known_weaknesses,
    changes_from_previous: calendar.changes_from_previous,
    unresolved_critiques: calendar.unresolved_critiques
  };
}

function compactCalendarForRevision(calendar: CalendarProposal) {
  return {
    version: calendar.calendar_version,
    days: calendar.days.map((day) => ({
      date: day.date,
      available_hours: day.assumed_available_hours,
      total_scheduled: day.blocks.reduce((s, b) => s + (b.duration_hours || 0), 0),
      blocks: day.blocks.map((b) => `${b.type}|${b.task_id ?? "-"}|${b.duration_hours}h|${b.description}`)
    })),
    strategy: calendar.overall_strategy,
    compromises: calendar.compromises.map((c) => `${c.conflict} → ${c.resolution}`)
  };
}

function compactCritiquesForRevision(critiques: AgentCritique[]) {
  return critiques
    .filter(
      (c) =>
        c.approval === "reject" ||
        c.severity === "critical" ||
        c.severity === "major" ||
        c.critiques.some((i) => i.severity === "critical" || i.severity === "major")
    )
    .map((c) => ({
      agent: c.agent,
      approval: c.approval,
      severity: c.severity,
      top_issues: c.critiques
        .filter((i) => i.severity === "critical" || i.severity === "major")
        .map((i) => i.issue)
        .slice(0, 3),
      overall: c.overall_comment
    }));
}

function formatWindow(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const fmt = (d: Date, includeYear: boolean) =>
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {})
    });
  return `${fmt(s, !sameYear)} → ${fmt(e, true)}`;
}
