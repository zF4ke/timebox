import fs from "node:fs";
import path from "node:path";
import type {
  BenchmarkExperiment,
  BenchmarkProgressEvent,
  BenchmarkRequest,
  BenchmarkRunSummary,
  PlanningResult
} from "../shared/types";
import { aggregateBenchmarkRuns, defaultProjectRoot, loadScenarios } from "./benchmarkAnalytics";
import { scoreBenchmarkResult, type BenchmarkScenario } from "./benchmarkScoring";
import { getPlannerDefaults, runPlanningPipeline } from "./planner";
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
  const outDir = path.resolve(options.outDir || path.join("benchmark-results", timestamp()));
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

  const experiment: BenchmarkExperiment = {
    id: path.basename(outDir),
    createdAt: new Date().toISOString(),
    resultsDir: outDir,
    runs: [],
    aggregates: []
  };

  writeManifest(outDir, options, benchmarkModels, scenarios);
  writeExperiment(outDir, experiment);

  const total = benchmarkModels.length * options.quorums.length * options.maxIterations.length * scenarios.length;
  let index = 0;
  onProgress({
    phase: "start",
    current: 0,
    total,
    summary: `Starting ${total} benchmark run(s).`
  });

  for (const model of benchmarkModels) {
    for (const quorum of options.quorums) {
      for (const maxIterations of options.maxIterations) {
        for (const scenario of scenarios) {
          throwIfCancelled(signal);
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
            quorum,
            maxIterations,
            scenario,
            runsDir,
            errorsDir,
            options.retries,
            signal
          );
          experiment.runs.push(run);
          experiment.aggregates = aggregateBenchmarkRuns(experiment.runs);
          writeExperiment(outDir, experiment);
          writeSummaryFiles(outDir, experiment.runs);
          onProgress({
            phase: run.status === "ok" ? "run_done" : "run_error",
            current: index,
            total,
            summary: run.status === "ok"
              ? `${scenario.title}: ${run.deterministicScore ?? "-"} deterministic · ${run.criticalMistakeCount} critical mistake(s)`
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runBenchmarkExperiment(options, (event) => {
    if (event.phase === "run_start" || event.phase === "run_done" || event.phase === "run_error" || event.phase === "complete") {
      console.log(`[benchmark] ${event.current}/${event.total} ${event.summary}`);
    }
  });
}

async function runScenarioWithRetries(
  model: string,
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
      return await runScenario(model, quorum, maxIterations, scenario, runsDir, signal);
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
  return errorRun(model, quorum, maxIterations, scenario, message, errorPath);
}

async function runScenario(
  model: string,
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
      evaluatorModel: model,
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

  return okRun(model, quorum, maxIterations, scenario, result, deterministic.score, deterministic.mistakeCount, deterministic.mistakes.filter((mistake) => mistake.severity === "critical").length, jsonPath, icsPath);
}

function okRun(
  model: string,
  quorum: number,
  maxIterations: number,
  scenario: BenchmarkScenario,
  result: PlanningResult,
  deterministicScore: number,
  mistakeCount: number,
  criticalMistakeCount: number,
  jsonPath: string,
  icsPath: string
): BenchmarkRunSummary {
  const finalVersion = result.calendarVersions.find(
    (record) => record.calendar.calendar_version === result.finalCalendar.calendar_version
  );
  const generationTime = result.evaluation.hard_metrics.metrics.find((metric) => metric.name === "generation_time_seconds");

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    difficulty: scenario.difficulty,
    model,
    quorum,
    maxIterations,
    status: "ok",
    overallScore: result.evaluation.overall_score,
    deterministicScore,
    modelScore: result.evaluation.model_score,
    hardScore: result.evaluation.hard_score,
    approvals: finalVersion?.approvals ?? null,
    iterations: result.calendarVersions.length,
    generationTimeSeconds: typeof generationTime?.value === "number" ? generationTime.value : null,
    estimatedCostUsd: result.usage.estimatedCostUsd,
    costSource: result.usage.estimatedCostUsd === null ? null : "traced",
    totalTokens: result.usage.totalTokens,
    mistakeCount,
    criticalMistakeCount,
    jsonPath,
    icsPath,
    error: ""
  };
}

function errorRun(
  model: string,
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
    jsonPath: "",
    icsPath: "",
    error: `${error} (${errorPath})`
  };
}

function parseArgs(args: string[]): BenchmarkOptions {
  const defaults = getPlannerDefaults();
  const options: BenchmarkOptions = {
    models: [defaults.model],
    quorums: [defaults.quorum],
    maxIterations: [defaults.maxIterations],
    scenarios: [],
    outDir: "",
    delayMs: 0,
    retries: 1,
    forceFree: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--models" && next) {
      options.models = splitList(next);
      i += 1;
    } else if (arg === "--quorums" && next) {
      options.quorums = splitList(next).map((value) => parsePositiveInt(value, "--quorums"));
      i += 1;
    } else if (arg === "--max-iterations" && next) {
      options.maxIterations = splitList(next).map((value) => parsePositiveInt(value, "--max-iterations"));
      i += 1;
    } else if (arg === "--scenarios" && next) {
      options.scenarios = splitList(next);
      i += 1;
    } else if (arg === "--out" && next) {
      options.outDir = next;
      i += 1;
    } else if (arg === "--delay-ms" && next) {
      options.delayMs = parsePositiveInt(next, "--delay-ms");
      i += 1;
    } else if (arg === "--retries" && next) {
      options.retries = parsePositiveInt(next, "--retries");
      i += 1;
    } else if (arg === "--force-free") {
      options.forceFree = true;
    } else if (arg === "--help") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
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
    forceFree: request.forceFree ?? false
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
  scenarios: BenchmarkScenario[]
): void {
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        models,
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
    "jsonPath",
    "icsPath",
    "error"
  ];
  const csv = [headers.join(","), ...runs.map((run) => headers.map((header) => csvEscape(String(run[header] ?? ""))).join(","))].join("\n");
  fs.writeFileSync(path.join(outDir, "summary.csv"), csv, "utf-8");
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must contain non-negative integers.`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log([
    "Usage:",
    "  npm run benchmark -- --models <m1,m2> --quorums 3,5 --max-iterations 2,3",
    "",
    "Options:",
    "  --models <list>          Comma-separated OpenRouter models. Default: configured model",
    "  --quorums <list>         Comma-separated quorum values. Default: configured quorum",
    "  --max-iterations <list>  Comma-separated max-iteration values. Default: configured value",
    "  --scenarios <list>       Optional comma-separated scenario ids or prompt filenames",
    "  --out <dir>              Output directory. Default: benchmark-results/<timestamp>",
    "  --delay-ms <n>           Delay between runs",
    "  --retries <n>            Retries for transient provider errors",
    "  --force-free             Allow :free models in benchmark runs"
  ].join("\n"));
  process.exit(0);
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
