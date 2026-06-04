import fs from "node:fs";
import path from "node:path";
import type {
  BenchmarkExperiment,
  BenchmarkProgressEvent,
  BenchmarkRequest,
  BenchmarkRunSummary,
  PlanningResult
} from "../shared/types";
import { aggregateBenchmarkRuns, defaultProjectRoot, getDataRoot, loadScenarios } from "./benchmarkAnalytics";
import { scoreBenchmarkResult, type BenchmarkScenario } from "./benchmarkScoring";
import { getPlannerDefaults, runPlanningPipeline } from "./planner";
import { promptsHash } from "./prompts";
import { isFreeModel } from "./modelCosts";

interface BenchmarkOptions {
  models: string[];
  quorums: number[];
  maxIterations: number[];
  scenarios: string[];
  outDir: string;
  delayMs: number;
  retries: number;
  forceFree: boolean;
  evaluatorModel: string;
  maxBudgetUsd: number | null;
}

type BenchmarkProgressCallback = (event: Omit<BenchmarkProgressEvent, "timestamp">) => void;

function noopProgress(): void {
  /* noop */
}

export async function runBenchmarkExperiment(
  request: BenchmarkRequest,
  onProgress: BenchmarkProgressCallback = noopProgress,
  signal?: AbortSignal
): Promise<BenchmarkExperiment> {
  const options = normalizeOptions(request);
  const rootDir = defaultProjectRoot();
  const allScenarios = loadScenarios(rootDir);
  const scenarios = selectScenarios(allScenarios, options.scenarios);
  const outDir = path.resolve(options.outDir || path.join(getDataRoot(), "benchmark-results", timestamp()));
  const runsDir = path.join(outDir, "runs");
  const errorsDir = path.join(outDir, "errors");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(errorsDir, { recursive: true });

  const models = options.models.length > 0 ? options.models : [getPlannerDefaults().model];
  const benchmarkModels = options.forceFree ? models : models.filter((model) => !isFreeModel(model));
  if (benchmarkModels.length === 0) {
    throw new Error("No benchmarkable models selected. Free models are skipped unless --force-free is passed.");
  }
  if (scenarios.length === 0) {
    throw new Error("No benchmark scenarios selected.");
  }

  const evaluatorModel = options.evaluatorModel || getPlannerDefaults().evaluatorModel;
  const promptHash = promptsHash();

  const experiment: BenchmarkExperiment = {
    id: path.basename(outDir),
    createdAt: new Date().toISOString(),
    resultsDir: outDir,
    runs: [],
    aggregates: [],
    evaluatorModel,
    promptHash,
    budgetUsd: options.maxBudgetUsd ?? undefined,
    stoppedByBudget: false
  };

  writeManifest(outDir, options, benchmarkModels, scenarios, evaluatorModel, promptHash);
  writeExperiment(outDir, experiment);

  const total = benchmarkModels.length * options.quorums.length * options.maxIterations.length * scenarios.length;
  let index = 0;
  let spentUsd = 0;
  onProgress({
    phase: "start",
    current: 0,
    total,
    summary: `Starting ${total} benchmark run(s)${options.maxBudgetUsd ? ` · budget $${options.maxBudgetUsd.toFixed(2)}` : ""} · judge ${formatCompactModel(evaluatorModel)} · prompts ${promptHash}`
  });

  for (const model of benchmarkModels) {
    for (const quorum of options.quorums) {
      for (const maxIterations of options.maxIterations) {
        for (const scenario of scenarios) {
          throwIfCancelled(signal);

          // Budget guard: stop before starting a run once we have already spent
          // up to (or past) the cap. We check before the run because a run's cost
          // is only known after it completes.
          if (options.maxBudgetUsd !== null && spentUsd >= options.maxBudgetUsd) {
            experiment.stoppedByBudget = true;
            writeExperiment(outDir, experiment);
            console.log(`[benchmark] budget cap $${options.maxBudgetUsd} reached after $${spentUsd.toFixed(4)}; stopping early.`);
            onProgress({
              phase: "complete",
              current: index,
              total,
              summary: `Stopped early at budget cap $${options.maxBudgetUsd.toFixed(2)} (spent $${spentUsd.toFixed(4)}).`
            });
            return experiment;
          }

          index += 1;
          onProgress({
            phase: "run_start",
            current: index,
            total,
            summary: `${formatCompactModel(model)} · Q${quorum} · ${maxIterations} iteration(s) · ${scenario.title}`
          });
          console.log(
            `[benchmark] ${index}/${total} model=${model} quorum=${quorum} maxIterations=${maxIterations} scenario=${scenario.id}`
          );

          const run = await runScenarioWithRetries(
            model,
            evaluatorModel,
            quorum,
            maxIterations,
            scenario,
            runsDir,
            errorsDir,
            options.retries,
            signal
          );
          spentUsd += run.estimatedCostUsd ?? 0;
          experiment.runs.push(run);
          experiment.aggregates = aggregateBenchmarkRuns(experiment.runs);
          writeExperiment(outDir, experiment);
          writeSummaryFiles(outDir, experiment.runs);
          onProgress({
            phase: run.status === "ok" ? "run_done" : "run_error",
            current: index,
            total,
            summary: run.status === "ok"
              ? `${scenario.title}: ${run.deterministicScore ?? "-"} deterministic · ${run.criticalMistakeCount} critical mistake(s) · spent $${spentUsd.toFixed(4)}`
              : `${scenario.title}: ${run.error}`,
            run
          });

          if (options.delayMs > 0 && index < total) {
            await cancellableSleep(options.delayMs, signal);
          }
        }
      }
    }
  }

  console.log(`[benchmark] complete: ${path.join(outDir, "experiment.json")}`);
  onProgress({
    phase: "complete",
    current: total,
    total,
    summary: `Benchmark complete: ${path.join(outDir, "experiment.json")}`
  });
  return experiment;
}

async function runScenarioWithRetries(
  model: string,
  evaluatorModel: string,
  quorum: number,
  maxIterations: number,
  scenario: BenchmarkScenario,
  runsDir: string,
  errorsDir: string,
  retries: number,
  signal?: AbortSignal
): Promise<BenchmarkRunSummary> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      throwIfCancelled(signal);
      if (attempt > 0) {
        console.log(`[benchmark] retry ${attempt}/${retries} ${scenario.id}`);
      }
      return await runScenario(model, evaluatorModel, quorum, maxIterations, scenario, runsDir, signal);
    } catch (error) {
      lastError = error;
      if (isAbortError(error)) {
        throw error;
      }
      if (attempt >= retries || !isRetryable(error)) {
        break;
      }
      await cancellableSleep(1000 + attempt * 1500, signal);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const errorPath = path.join(errorsDir, `${safeName(model)}__q${quorum}__i${maxIterations}__${scenario.id}.txt`);
  fs.writeFileSync(errorPath, message, "utf-8");
  return errorRun(model, evaluatorModel, quorum, maxIterations, scenario, message, errorPath);
}

async function runScenario(
  model: string,
  evaluatorModel: string,
  quorum: number,
  maxIterations: number,
  scenario: BenchmarkScenario,
  runsDir: string,
  signal?: AbortSignal
): Promise<BenchmarkRunSummary> {
  const promptPath = path.join(defaultProjectRoot(), "prompts", scenario.promptFile);
  const userInput = fs.readFileSync(promptPath, "utf-8").trim();

  const result = await runPlanningPipeline(
    {
      userInput,
      model,
      evaluatorModel,
      quorum,
      maxIterations
    },
    (event) => {
      const version = event.iteration ? ` v${event.iteration}` : "";
      const agent = event.agent ? ` ${event.agent}` : "";
      const summary = event.summary ? ` - ${event.summary}` : "";
      console.log(`[benchmark:${scenario.id}] ${event.phase}${version}${agent} ${event.status}${summary}`);
    },
    signal
  );

  const deterministic = scoreBenchmarkResult(result, scenario);
  const stem = `${safeName(model)}__q${quorum}__i${maxIterations}__${scenario.id}`;
  const jsonPath = path.join(runsDir, `${stem}.json`);
  const icsPath = path.join(runsDir, `${stem}.ics`);
  const mistakesPath = path.join(runsDir, `${stem}.mistakes.json`);
  fs.writeFileSync(jsonPath, result.exports.json, "utf-8");
  fs.writeFileSync(icsPath, result.exports.ics, "utf-8");
  fs.writeFileSync(mistakesPath, JSON.stringify(deterministic, null, 2), "utf-8");

  return okRun(model, evaluatorModel, quorum, maxIterations, scenario, result, deterministic, jsonPath, icsPath);
}

function okRun(
  model: string,
  evaluatorModel: string,
  quorum: number,
  maxIterations: number,
  scenario: BenchmarkScenario,
  result: PlanningResult,
  deterministic: ReturnType<typeof scoreBenchmarkResult>,
  jsonPath: string,
  icsPath: string
): BenchmarkRunSummary {
  const finalVersion = result.calendarVersions.find(
    (record) => record.calendar.calendar_version === result.finalCalendar.calendar_version
  );
  // Benchmark runs always evaluate, so result.evaluation is expected here.
  const evaluation = result.evaluation;
  const generationTime = evaluation?.hard_metrics.metrics.find((metric) => metric.name === "generation_time_seconds");

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    difficulty: scenario.difficulty,
    model,
    quorum,
    maxIterations,
    status: "ok",
    overallScore: evaluation?.overall_score ?? null,
    deterministicScore: deterministic.score,
    modelScore: evaluation?.model_score ?? null,
    hardScore: evaluation?.hard_score ?? null,
    approvals: finalVersion?.approvals ?? null,
    iterations: result.calendarVersions.length,
    generationTimeSeconds: typeof generationTime?.value === "number" ? generationTime.value : null,
    estimatedCostUsd: result.usage.estimatedCostUsd,
    costSource: result.usage.estimatedCostUsd === null ? null : "traced",
    totalTokens: result.usage.totalTokens,
    mistakeCount: deterministic.mistakeCount,
    criticalMistakeCount: deterministic.mistakes.filter((mistake) => mistake.severity === "critical").length,
    mistakes: deterministic.mistakes,
    evaluatorModel,
    jsonPath,
    icsPath,
    error: ""
  };
}

function errorRun(
  model: string,
  evaluatorModel: string,
  quorum: number,
  maxIterations: number,
  scenario: BenchmarkScenario,
  error: string,
  errorPath: string
): BenchmarkRunSummary {
  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    difficulty: scenario.difficulty,
    model,
    quorum,
    maxIterations,
    status: "error",
    overallScore: null,
    deterministicScore: null,
    modelScore: null,
    hardScore: null,
    approvals: null,
    iterations: null,
    generationTimeSeconds: null,
    estimatedCostUsd: null,
    costSource: null,
    totalTokens: null,
    mistakeCount: 1,
    criticalMistakeCount: 1,
    mistakes: [],
    evaluatorModel,
    jsonPath: "",
    icsPath: "",
    error: `${error} (${errorPath})`
  };
}

function normalizeOptions(request: BenchmarkRequest): BenchmarkOptions {
  const defaults = getPlannerDefaults();
  return {
    models: request.models.length > 0 ? request.models : [defaults.model],
    quorums: request.quorums.length > 0 ? request.quorums : [defaults.quorum],
    maxIterations: request.maxIterations.length > 0 ? request.maxIterations : [defaults.maxIterations],
    scenarios: request.scenarios,
    outDir: request.outDir ?? "",
    delayMs: request.delayMs ?? 0,
    retries: request.retries ?? 1,
    forceFree: request.forceFree ?? false,
    evaluatorModel: request.evaluatorModel?.trim() || defaults.evaluatorModel,
    maxBudgetUsd: typeof request.maxBudgetUsd === "number" && request.maxBudgetUsd > 0 ? request.maxBudgetUsd : null
  };
}

function selectScenarios(all: BenchmarkScenario[], selected: string[]): BenchmarkScenario[] {
  if (selected.length === 0) {
    return all;
  }
  const set = new Set(selected);
  return all.filter((scenario) => set.has(scenario.id) || set.has(scenario.promptFile));
}

function writeManifest(
  outDir: string,
  options: BenchmarkOptions,
  models: string[],
  scenarios: BenchmarkScenario[],
  evaluatorModel: string,
  promptHash: string
): void {
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        models,
        evaluatorModel,
        promptHash,
        budgetUsd: options.maxBudgetUsd ?? null,
        quorums: options.quorums,
        maxIterations: options.maxIterations,
        scenarioIds: scenarios.map((scenario) => scenario.id),
        freeModelsSkippedUnlessForced: !options.forceFree
      },
      null,
      2
    ),
    "utf-8"
  );
}

function writeExperiment(outDir: string, experiment: BenchmarkExperiment): void {
  fs.writeFileSync(path.join(outDir, "experiment.json"), JSON.stringify(experiment, null, 2), "utf-8");
}

function writeSummaryFiles(outDir: string, runs: BenchmarkRunSummary[]): void {
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(runs, null, 2), "utf-8");
  const headers: Array<keyof BenchmarkRunSummary> = [
    "scenarioId",
    "scenarioTitle",
    "difficulty",
    "model",
    "quorum",
    "maxIterations",
    "status",
    "overallScore",
    "deterministicScore",
    "modelScore",
    "hardScore",
    "approvals",
    "iterations",
    "generationTimeSeconds",
    "estimatedCostUsd",
    "costSource",
    "totalTokens",
    "mistakeCount",
    "criticalMistakeCount",
    "evaluatorModel",
    "jsonPath",
    "icsPath",
    "error"
  ];
  const csv = [headers.join(","), ...runs.map((run) => headers.map((header) => csvEscape(String(run[header] ?? ""))).join(","))].join("\n");
  fs.writeFileSync(path.join(outDir, "summary.csv"), csv, "utf-8");
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ["timeout", "429", "rate limit", "temporarily", "overloaded", "provider error"].some((needle) =>
    message.toLowerCase().includes(needle)
  );
}

function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("cancelled") || message.toLowerCase().includes("aborted");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return sleep(ms);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Benchmark run cancelled."));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Benchmark run cancelled.");
  }
}

function formatCompactModel(model: string): string {
  return model.split("/").at(-1) ?? model;
}
