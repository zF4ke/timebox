import fs from "node:fs";
import path from "node:path";
import type { HardMetricName, PlanningResult } from "../shared/types";
import { getPlannerDefaults, runPlanningPipeline } from "./planner";

process.on("unhandledRejection", (reason) => {
  if (isAbortError(reason) || isRetryable(reason)) {
    return;
  }
  throw reason;
});

interface BatchOptions {
  promptsDir: string;
  outDir: string;
  model?: string;
  quorum?: number;
  maxIterations?: number;
  delayMs: number;
  retries: number;
  only?: string;
}

interface BatchRow {
  prompt: string;
  model: string;
  status: "ok" | "error";
  overall_score: number | "";
  model_score: number | "";
  hard_score: number | "";
  approvals: number | "";
  iterations: number | "";
  critical_count: number | "";
  major_count: number | "";
  deadline_violations: number | "";
  task_coverage: number | "";
  availability_overrun: number | "";
  stop_reason: string;
  json_path: string;
  ics_path: string;
  error: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const defaults = getPlannerDefaults();
  const model = options.model ?? defaults.model;
  const quorum = options.quorum ?? defaults.quorum;
  const maxIterations = options.maxIterations ?? defaults.maxIterations;
  const promptsDir = path.resolve(options.promptsDir);
  const outDir = path.resolve(options.outDir || defaultOutDir(model));
  const runsDir = path.join(outDir, "runs");
  const errorsDir = path.join(outDir, "errors");

  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(errorsDir, { recursive: true });

  const rows: BatchRow[] = loadExistingRows(outDir);
  const completedPrompts = new Set(rows.map((row) => row.prompt));
  const promptFiles = listPromptFiles(promptsDir, options.only).filter((promptPath) => {
    return !completedPrompts.has(path.basename(promptPath));
  });
  if (promptFiles.length === 0) {
    console.log(`[batch] no remaining prompts found in ${promptsDir}`);
    return;
  }

  console.log(`[batch] model=${model}`);
  console.log(`[batch] quorum=${quorum} maxIterations=${maxIterations}`);
  console.log(`[batch] prompts=${promptsDir}`);
  console.log(`[batch] output=${outDir}`);
  console.log(`[batch] count=${promptFiles.length}`);
  if (completedPrompts.size > 0) {
    console.log(`[batch] resuming after ${completedPrompts.size} existing row(s)`);
  }

  for (let index = 0; index < promptFiles.length; index += 1) {
    const promptPath = promptFiles[index];
    const promptName = path.basename(promptPath);
    const promptSlug = path.basename(promptPath, ".txt");
    const userInput = fs.readFileSync(promptPath, "utf-8").trim();

    console.log(`\n[batch] ${index + 1}/${promptFiles.length} ${promptName}`);

    try {
      const result = await runPromptWithRetries(
        {
          userInput,
          model,
          quorum,
          maxIterations
        },
        (event) => {
          const agent = event.agent ? ` ${event.agent}` : "";
          const version = event.iteration ? ` v${event.iteration}` : "";
          const summary = event.summary ? ` - ${event.summary}` : "";
          console.log(`[batch:${promptSlug}] ${event.phase}${version}${agent} ${event.status}${summary}`);
        },
        options.retries
      );

      const jsonPath = path.join(runsDir, `${promptSlug}.json`);
      const icsPath = path.join(runsDir, `${promptSlug}.ics`);
      fs.writeFileSync(jsonPath, result.exports.json, "utf-8");
      fs.writeFileSync(icsPath, result.exports.ics, "utf-8");

      rows.push(okRow(promptName, model, result, jsonPath, icsPath));
      writeSummaries(outDir, rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorPath = path.join(errorsDir, `${promptSlug}.txt`);
      fs.writeFileSync(errorPath, message, "utf-8");
      rows.push(errorRow(promptName, model, message));
      writeSummaries(outDir, rows);
      console.error(`[batch] failed ${promptName}: ${message}`);
    }

    if (options.delayMs > 0 && index < promptFiles.length - 1) {
      await sleep(options.delayMs);
    }
  }

  console.log(`\n[batch] done`);
  console.log(`[batch] summary CSV: ${path.join(outDir, "summary.csv")}`);
  console.log(`[batch] summary JSON: ${path.join(outDir, "summary.json")}`);
  console.log(`[batch] full runs: ${runsDir}`);
}

function parseArgs(args: string[]): BatchOptions {
  const options: BatchOptions = {
    promptsDir: "prompts",
    outDir: "",
    delayMs: 0,
    retries: 1
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--model" && next) {
      options.model = next;
      i += 1;
    } else if (arg === "--prompts" && next) {
      options.promptsDir = next;
      i += 1;
    } else if (arg === "--out" && next) {
      options.outDir = next;
      i += 1;
    } else if (arg === "--quorum" && next) {
      options.quorum = parsePositiveInt(next, "--quorum");
      i += 1;
    } else if (arg === "--max-iterations" && next) {
      options.maxIterations = parsePositiveInt(next, "--max-iterations");
      i += 1;
    } else if (arg === "--delay-ms" && next) {
      options.delayMs = parsePositiveInt(next, "--delay-ms");
      i += 1;
    } else if (arg === "--retries" && next) {
      options.retries = parsePositiveInt(next, "--retries");
      i += 1;
    } else if (arg === "--only" && next) {
      options.only = next;
      i += 1;
    } else if (arg === "--help") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log([
    "Usage:",
    "  npm run batch -- --model <openrouter-model> [options]",
    "",
    "Options:",
    "  --prompts <dir>          Directory containing .txt prompts. Default: prompts",
    "  --out <dir>              Output directory. Default: results/<model>-<timestamp>",
    "  --quorum <n>             Required approvals. Default: app setting",
    "  --max-iterations <n>     Max planner drafts. Default: app setting",
    "  --delay-ms <n>           Delay between prompts. Default: 0",
    "  --retries <n>            Retries per prompt after transient failures. Default: 1",
    "  --only <filename>        Run one prompt file from the prompts directory"
  ].join("\n"));
  process.exit(0);
}

async function runPromptWithRetries(
  request: Parameters<typeof runPlanningPipeline>[0],
  onProgress: Parameters<typeof runPlanningPipeline>[1],
  retries: number
): Promise<PlanningResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    try {
      if (attempt > 0) {
        console.log(`[batch] retry ${attempt}/${retries}`);
      }
      return await runPlanningPipeline(request, onProgress, controller.signal);
    } catch (error) {
      controller.abort();
      lastError = error;
      if (attempt >= retries || !isRetryable(error)) {
        throw error;
      }
      await sleep(1500 * attempt + 1000);
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "empty response",
    "timeout",
    "timed out",
    "429",
    "rate limit",
    "temporarily",
    "overloaded",
    "provider error",
    "terminated"
  ].some((needle) => message.toLowerCase().includes(needle));
}

function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const lower = message.toLowerCase();
  return name === "AbortError" || lower.includes("aborted") || lower.includes("terminated");
}

function listPromptFiles(promptsDir: string, only?: string): string[] {
  const files = fs
    .readdirSync(promptsDir)
    .filter((file) => file.endsWith(".txt"))
    .sort();

  const selected = only ? files.filter((file) => file === only || path.basename(file, ".txt") === only) : files;
  return selected.map((file) => path.join(promptsDir, file));
}

function okRow(prompt: string, model: string, result: PlanningResult, jsonPath: string, icsPath: string): BatchRow {
  const metrics = metricsByName(result);
  const finalVersion = result.calendarVersions.find(
    (record) => record.calendar.calendar_version === result.finalCalendar.calendar_version
  );

  return {
    prompt,
    model,
    status: "ok",
    overall_score: result.evaluation.overall_score,
    model_score: result.evaluation.model_score,
    hard_score: result.evaluation.hard_score,
    approvals: finalVersion?.approvals ?? "",
    iterations: result.calendarVersions.length,
    critical_count: metrics.critical_count ?? "",
    major_count: metrics.major_count ?? "",
    deadline_violations: metrics.deadline_violation_count ?? "",
    task_coverage: metrics.task_coverage_ratio ?? "",
    availability_overrun: metrics.availability_overrun_hours ?? "",
    stop_reason: result.stopReason,
    json_path: jsonPath,
    ics_path: icsPath,
    error: ""
  };
}

function errorRow(prompt: string, model: string, error: string): BatchRow {
  return {
    prompt,
    model,
    status: "error",
    overall_score: "",
    model_score: "",
    hard_score: "",
    approvals: "",
    iterations: "",
    critical_count: "",
    major_count: "",
    deadline_violations: "",
    task_coverage: "",
    availability_overrun: "",
    stop_reason: "",
    json_path: "",
    ics_path: "",
    error
  };
}

function loadExistingRows(outDir: string): BatchRow[] {
  const summaryPath = path.join(outDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    return Array.isArray(parsed) ? (parsed as BatchRow[]) : [];
  } catch {
    return [];
  }
}

function metricsByName(result: PlanningResult): Partial<Record<HardMetricName, number>> {
  return Object.fromEntries(result.evaluation.hard_metrics.metrics.map((metric) => [metric.name, metric.value]));
}

function writeSummaries(outDir: string, rows: BatchRow[]): void {
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2), "utf-8");
  fs.writeFileSync(path.join(outDir, "summary.csv"), toCsv(rows), "utf-8");
}

function toCsv(rows: BatchRow[]): string {
  const headers: Array<keyof BatchRow> = [
    "prompt",
    "model",
    "status",
    "overall_score",
    "model_score",
    "hard_score",
    "approvals",
    "iterations",
    "critical_count",
    "major_count",
    "deadline_violations",
    "task_coverage",
    "availability_overrun",
    "stop_reason",
    "json_path",
    "ics_path",
    "error"
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(String(row[header]))).join(","))
  ].join("\n");
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function defaultOutDir(model: string): string {
  return path.join("results", `${safeName(model)}-${timestamp()}`);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
