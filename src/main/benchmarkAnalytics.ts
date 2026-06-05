import fs from "node:fs";
import path from "node:path";
import type {
  BenchmarkAggregate,
  BenchmarkExperiment,
  BenchmarkRunSummary,
  ClearBenchmarkResult,
  PlanningResult
} from "../shared/types";
import { scoreBenchmarkResult, type BenchmarkScenario } from "./benchmarkScoring";
import { estimateModelCostUsd, estimateTokensFromChars } from "./modelCosts";

import { app } from "electron";

export function getDataRoot(): string {
  const root = app.getPath("userData");
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

interface LegacySummaryRow {
  prompt: string;
  model: string;
  status: "ok" | "error";
  overall_score: number | "";
  model_score: number | "";
  hard_score: number | "";
  approvals: number | "";
  iterations: number | "";
  stop_reason: string;
  json_path: string;
  ics_path: string;
  error: string;
}

export function listBenchmarkExperiments(rootDir = defaultProjectRoot()): BenchmarkExperiment[] {
  const scenarios = loadScenarios(rootDir);
  const experiments: BenchmarkExperiment[] = [];
  const dataRoot = getDataRoot();
  experiments.push(...readLegacyResultExperiments(dataRoot, scenarios));
  experiments.push(...readStoredBenchmarkExperiments(dataRoot, scenarios));
  return experiments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function clearBenchmarkExperiments(): ClearBenchmarkResult {
  const cleared: string[] = [];
  const errors: string[] = [];
  const root = getDataRoot();
  for (const dirName of ["results", "benchmark-results"]) {
    const dir = path.join(root, dirName);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        if (fs.existsSync(dir)) {
          errors.push(`${dirName}: directory still exists after deletion`);
        } else {
          cleared.push(dirName);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[benchmark] failed to clear ${dir}:`, err);
      errors.push(`${dirName}: ${message}`);
    }
  }
  return { success: errors.length === 0, cleared, errors };
}

export function loadScenarios(rootDir = defaultProjectRoot()): BenchmarkScenario[] {
  const scenariosPath = path.join(rootDir, "benchmarks", "scenarios.json");
  if (!fs.existsSync(scenariosPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(scenariosPath, "utf-8"));
  return Array.isArray(parsed) ? (parsed as BenchmarkScenario[]) : [];
}

export function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "benchmarks", "scenarios.json"))) {
    return cwd;
  }

  const bundledRoot = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(bundledRoot, "benchmarks", "scenarios.json"))) {
    return bundledRoot;
  }

  return cwd;
}

export function aggregateBenchmarkRuns(runs: BenchmarkRunSummary[]): BenchmarkAggregate[] {
  const groups = new Map<string, BenchmarkRunSummary[]>();
  for (const run of runs) {
    const key = `${run.model}__${run.evaluatorModel ?? ""}__${run.quorum}__${run.maxIterations}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  return Array.from(groups.values())
    .map((group) => {
      const first = group[0];
      const ok = group.filter((run) => run.status === "ok");
      const averageOverallScore = average(ok.map((run) => run.overallScore));
      const averageModelScore = average(ok.map((run) => run.modelScore));
      const averageDeterministicScore = average(ok.map((run) => run.deterministicScore));
      const averageCostUsd = average(ok.map((run) => run.estimatedCostUsd));
      const averageTokens = average(ok.map((run) => run.totalTokens));
      const averageIterations = average(ok.map((run) => run.iterations));
      const averageGenerationTimeSeconds = average(ok.map((run) => run.generationTimeSeconds));
      const criticalMistakes = group.reduce((sum, run) => sum + run.criticalMistakeCount, 0);
      const totalMistakes = group.reduce((sum, run) => sum + run.mistakeCount, 0);

      return {
        model: first.model,
        evaluatorModel: first.evaluatorModel ?? null,
        quorum: first.quorum,
        maxIterations: first.maxIterations,
        runCount: group.length,
        okCount: ok.length,
        averageOverallScore,
        averageDeterministicScore,
        averageCostUsd,
        averageTokens,
        averageIterations,
        averageGenerationTimeSeconds,
        costBenefitScore: costBenefit({
          averageDeterministicScore,
          averageModelScore,
          averageCostUsd,
          okCount: ok.length,
          runCount: group.length,
          criticalMistakes,
          totalMistakes
        }),
        criticalMistakes,
        totalMistakes
      };
    })
    .sort(compareAggregate);
}

function readLegacyResultExperiments(rootDir: string, scenarios: BenchmarkScenario[]): BenchmarkExperiment[] {
  const resultsDir = path.join(rootDir, "results");
  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  return fs
    .readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(resultsDir, entry.name);
      const summaryPath = path.join(dir, "summary.json");
      if (!fs.existsSync(summaryPath)) {
        return null;
      }
      const rows = JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as LegacySummaryRow[];
      const runs = rows.map((row) => legacyRowToRun(row, dir, scenarios));
      return {
        id: `legacy-${entry.name}`,
        createdAt: directoryCreatedAt(dir),
        resultsDir: dir,
        runs,
        aggregates: aggregateBenchmarkRuns(runs)
      };
    })
    .filter((experiment): experiment is BenchmarkExperiment => Boolean(experiment));
}

function readStoredBenchmarkExperiments(rootDir: string, scenarios: BenchmarkScenario[]): BenchmarkExperiment[] {
  const benchmarkDir = path.join(rootDir, "benchmark-results");
  if (!fs.existsSync(benchmarkDir)) {
    return [];
  }

  const experiments: BenchmarkExperiment[] = [];
  for (const entry of fs.readdirSync(benchmarkDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const experimentDir = path.join(benchmarkDir, entry.name);
    const experimentPath = path.join(experimentDir, "experiment.json");
    if (!fs.existsSync(experimentPath)) continue;
    try {
      const experiment = JSON.parse(fs.readFileSync(experimentPath, "utf-8")) as BenchmarkExperiment;
      experiments.push(normalizeStoredExperiment(experiment, experimentDir, scenarios));
    } catch {
      // Ignore incomplete experiments; the CLI writes summaries incrementally.
    }
  }
  return experiments;
}

function normalizeStoredExperiment(
  experiment: BenchmarkExperiment,
  experimentDir: string,
  scenarios: BenchmarkScenario[]
): BenchmarkExperiment {
  const runsDir = path.join(experimentDir, "runs");
  const runs = experiment.runs.map((run) => {
    const jsonPath = resolveStoredRunArtifact(run.jsonPath, runsDir);
    const icsPath = resolveStoredRunArtifact(run.icsPath, runsDir);
    // Rescore from the saved planner result so the current scoring formula applies
    // retroactively (no rerun). Falls back to the stored score if the run artifact
    // or its scenario is missing. Cost / judge fields are left untouched.
    const rescored = rescoreStoredRun({ ...run, jsonPath, icsPath }, scenarios);
    return rescored;
  });
  return {
    ...experiment,
    resultsDir: experimentDir,
    runs,
    aggregates: aggregateBenchmarkRuns(runs)
  };
}

function rescoreStoredRun(run: BenchmarkRunSummary, scenarios: BenchmarkScenario[]): BenchmarkRunSummary {
  if (run.status !== "ok" || !run.jsonPath) {
    return run;
  }
  const scenario = scenarios.find((candidate) => candidate.id === run.scenarioId);
  const result = readPlanningResult(run.jsonPath);
  if (!scenario || !result) {
    return run;
  }
  const scored = scoreBenchmarkResult(result, scenario);
  return {
    ...run,
    deterministicScore: scored.score,
    mistakeCount: scored.mistakeCount,
    criticalMistakeCount: scored.mistakes.filter((mistake) => mistake.severity === "critical").length,
    mistakes: scored.mistakes
  };
}

function resolveStoredRunArtifact(storedPath: string, runsDir: string): string {
  if (!storedPath) {
    return "";
  }
  if (fs.existsSync(storedPath)) {
    return storedPath;
  }
  const candidate = path.join(runsDir, path.basename(storedPath));
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return storedPath;
}

function legacyRowToRun(row: LegacySummaryRow, resultDir: string, scenarios: BenchmarkScenario[]): BenchmarkRunSummary {
  const scenario = scenarios.find((candidate) => candidate.promptFile === row.prompt);
  const slug = row.prompt.replace(/\.txt$/, "");
  const jsonPath = resolveArtifact(row.json_path, path.join(resultDir, "runs", `${slug}.json`));
  const icsPath = resolveArtifact(row.ics_path, path.join(resultDir, "runs", `${slug}.ics`));
  const maxIterations = typeof row.iterations === "number" ? row.iterations : 3;

  if (row.status === "error") {
    return {
      scenarioId: scenario?.id ?? slug,
      scenarioTitle: scenario?.title ?? slug,
      difficulty: scenario?.difficulty ?? "medium",
      model: row.model,
      quorum: 5,
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
      evaluatorModel: null,
      jsonPath,
      icsPath,
      error: row.error
    };
  }

  const result = readPlanningResult(jsonPath);
  const deterministic = result && scenario ? scoreBenchmarkResult(result, scenario) : null;
  const legacyUsage = result ? estimateLegacyUsage(row.model, jsonPath) : { cost: null, tokens: null };
  const tracedCost = result?.usage?.estimatedCostUsd ?? null;
  const tracedTokens = result?.usage?.totalTokens ?? null;

  return {
    scenarioId: scenario?.id ?? slug,
    scenarioTitle: scenario?.title ?? slug,
    difficulty: scenario?.difficulty ?? "medium",
    model: row.model,
    quorum: result?.request.quorum ?? 5,
    maxIterations: result?.request.maxIterations ?? maxIterations,
    status: "ok",
    overallScore: numeric(row.overall_score),
    deterministicScore: deterministic?.score ?? null,
    modelScore: numeric(row.model_score),
    hardScore: numeric(row.hard_score),
    approvals: numeric(row.approvals),
    iterations: numeric(row.iterations),
    generationTimeSeconds: hardMetric(result, "generation_time_seconds"),
    estimatedCostUsd: tracedCost ?? legacyUsage.cost,
    costSource: tracedCost !== null ? "traced" : legacyUsage.cost !== null ? "legacy_estimate" : null,
    totalTokens: tracedTokens ?? legacyUsage.tokens,
    mistakeCount: deterministic?.mistakeCount ?? 0,
    criticalMistakeCount: deterministic?.mistakes.filter((mistake) => mistake.severity === "critical").length ?? 0,
    mistakes: deterministic?.mistakes ?? [],
    evaluatorModel: result?.request.evaluatorModel ?? null,
    jsonPath,
    icsPath,
    error: ""
  };
}

function estimateLegacyUsage(model: string, jsonPath: string): { cost: number | null; tokens: number | null } {
  if (!fs.existsSync(jsonPath)) {
    return { cost: null, tokens: null };
  }

  const artifactChars = fs.readFileSync(jsonPath, "utf-8").length;
  const promptTokens = estimateTokensFromChars(artifactChars * 2);
  const completionTokens = estimateTokensFromChars(artifactChars);
  return {
    cost: estimateModelCostUsd(model, promptTokens, completionTokens),
    tokens: promptTokens + completionTokens
  };
}

function resolveArtifact(storedPath: string, fallbackPath: string): string {
  if (storedPath && fs.existsSync(storedPath)) {
    return storedPath;
  }
  return fallbackPath;
}

function readPlanningResult(jsonPath: string): PlanningResult | null {
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    return (parsed.result ?? parsed) as PlanningResult;
  } catch {
    return null;
  }
}

function hardMetric(result: PlanningResult | null, name: string): number | null {
  const metric = result?.evaluation?.hard_metrics?.metrics?.find((candidate) => candidate.name === name);
  return typeof metric?.value === "number" ? metric.value : null;
}

function directoryCreatedAt(dir: string): string {
  try {
    return fs.statSync(dir).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function numeric(value: number | ""): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 1000) / 1000;
}

function costBenefit(input: {
  averageDeterministicScore: number | null;
  averageModelScore: number | null;
  averageCostUsd: number | null;
  okCount: number;
  runCount: number;
  criticalMistakes: number;
  totalMistakes: number;
}): number | null {
  if (input.averageDeterministicScore === null) {
    return null;
  }

  const deterministic = input.averageDeterministicScore; // 0-100

  // Use the INDEPENDENT judge only (modelScore). We deliberately avoid
  // overallScore here: overallScore already folds in hardScore (a deterministic
  // metric), so blending it would double-count deterministic evidence and dilute
  // the judge's nominal weight to ~7.5%. modelScore (1-5) rescaled to 0-100 keeps
  // the judge a genuine, independent cross-check.
  const judge = input.averageModelScore === null ? deterministic : input.averageModelScore * 20;

  // Deterministic-first, but the judge is a real 30% secondary signal. Both terms
  // are on a 0-100 scale with comparable spread (sd ~ 8), so these weights reflect
  // actual contribution to the ranking, not an artifact of differing units.
  const quality = deterministic * 0.7 + judge * 0.3;

  // Reliability is handled as an explicit penalty rather than blended into quality:
  // it is near-constant (almost every config passes all runs), so including it in a
  // variance-driven weighted sum consumed weight while adding no discriminating
  // signal. A config that crashes runs is now docked directly.
  const failureRate = input.runCount > 0 ? 1 - input.okCount / input.runCount : 0;
  const failurePenalty = failureRate * 40;

  const criticalPerRun = input.criticalMistakes / Math.max(input.runCount, 1);
  const totalPerRun = input.totalMistakes / Math.max(input.runCount, 1);
  const nonCriticalPerRun = Math.max(0, totalPerRun - criticalPerRun);
  const mistakePenalty = criticalPerRun * 4 + nonCriticalPerRun * 0.7;

  // Keep cost in the ranking, but do not let cent-level differences overwhelm
  // quality. log10 makes $0.015 vs $0.018 a small tie-breaker instead of a huge
  // ratio swing, while genuinely expensive runs still lose value.
  const costPenalty = input.averageCostUsd === null
    ? 0
    : Math.min(12, Math.log10(1 + input.averageCostUsd * 1000) * 2.5);

  return Math.round(
    Math.max(0, Math.min(100, quality - failurePenalty - mistakePenalty - costPenalty)) * 10
  ) / 10;
}

function compareAggregate(a: BenchmarkAggregate, b: BenchmarkAggregate): number {
  return (b.costBenefitScore ?? -1) - (a.costBenefitScore ?? -1);
}
