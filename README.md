# Timebox

Electron prototype for Timebox, the AASMA multi-agent student planning app.

## Setup

```bash
npm install
```

All configuration is managed in-app via **Settings** (model, quorum, max iterations, API key). Settings are persisted to the OS user-data directory. The default model is `nvidia/nemotron-3-super-120b-a12b:free`.

## Run

```bash
npm run dev
```

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Benchmark Models

The final-delivery benchmark is separate from the normal planner UI. It runs fixed student inputs across a model/quorum/iteration matrix and stores every artifact needed for later plots and prompt-debugging.

The current baseline interpretation of the pulled result sets is in [`docs/benchmark_summary.md`](docs/benchmark_summary.md).

In the app, open **Analytics** and click **Run benchmark**. The launcher uses non-free models only, shows the number of planned runs before starting, streams progress, and can be cancelled.

```bash
npm run benchmark -- --models google/gemini-3.1-flash-lite-preview,deepseek/deepseek-v3.2 --quorums 3,5 --max-iterations 2,3
```

Useful options:

```bash
npm run benchmark -- --scenarios 01_urgent_mixed_deadlines,13_conflicting_preferences
npm run benchmark -- --out benchmark-results/my-run --delay-ms 1000 --retries 2
```

Benchmark outputs go to `benchmark-results/<timestamp>/`:

- `manifest.json` — models, quorum values, iteration values, scenario ids, and free-model policy.
- `experiment.json` — all run summaries plus aggregate rankings.
- `summary.json` / `summary.csv` — flat run table for plotting.
- `runs/*.json` — full planning result with interpreter output, agent views, all calendar versions, critiques, validation, evaluation, and per-call usage/cost traces.
- `runs/*.ics` — calendar export for each run.
- `runs/*.mistakes.json` — deterministic score breakdown and labeled mistakes.
- `errors/*.txt` — provider/runtime failures.

Free OpenRouter models containing `:free` are skipped by default because they are too slow for benchmarking. Use `--force-free` only for a deliberate one-off comparison.

## Package for distribution

```bash
npm run dist
```

Output goes to `release/` (gitignored). On Windows this produces a portable `.exe`. On macOS a `.dmg`. On Linux an `AppImage`.

### Production setup

1. Build the app: `npm run dist`
2. Run the app and set your OpenRouter API key in **Settings**.
3. Settings (model, quorum, max iterations, API key) and saved plans are stored in the OS user-data directory, not the project folder.

## Behavior

- **Interpreter Agent** infers tasks, deadlines, availability, planning window, student state, and assumptions.
- **Specialist Agents** (Deadline, Grade, Effort, Wellbeing, Risk) produce separate task views in parallel.
- **Planner-Arbiter** creates and revises calendar versions based on agent critiques.
- **Specialist agents critique** each calendar version. Approval requires no critical critiques and at least `quorum` approvals (configurable, default 5).
- **Validation** checks structural issues (deadline violations, unknown tasks, rest blocks) but is informational only — it does not block acceptance.
- **Stop condition**: no critical critique + approvals ≥ quorum, or max iterations reached.
- **Schedule Evaluator** scores the selected final calendar after acceptance. It is diagnostic only and runs **only during benchmarks** (interactive planner runs skip it to save credits). A single **fixed judge model** scores every model under test so scores stay comparable. The final evaluation is 50% model judgement and 50% deterministic hard metrics.
- **JSON export** = full audit trail with reasoning. **ICS export** = importable into Google/Apple Calendar.

## UI Features

- **Composer** — natural language input for tasks and constraints.
- **Live progress** — planning steps rendered newest-first with fade-by-age animation.
- **Cancel run** — abort an in-progress planning run.
- **Calendar view** — FullCalendar week grid with color-coded event types.
- **Event details** — click any calendar block to see description, reasoning, and timing.
- **Saved plans sidebar** — auto-saves plans, with load and delete.
- **Settings** — configurable quorum (1–5), max iterations (1–5), planner model picker with pricing, a fixed **evaluator (judge) model** for benchmarks, and OpenRouter API key. Persisted to the OS user-data directory.
- **Run cost** — calendar results show traced schedule cost in green when available. (Quality scoring is intentionally exclusive to the Analytics/benchmark section.)
- **Analytics view** — separate benchmark dashboard for model/quorum/iteration comparisons, deterministic scores, a cost-vs-quality scatter chart, cost-benefit ranking, token/cost estimates, an aggregated **top-mistakes** panel for prompt tuning, the judge model and prompt hash in effect, a per-matrix **budget cap**, and in-app benchmark execution.
- **Import** — drag-and-drop JSON/ICS files anywhere on the app, or use the Import button in the sidebar.
- **Humanized task IDs** — raw IDs like "T1" are automatically replaced with task names in all UI text.

## Model Options

| Model | Input / Output (per 1M tokens) |
|-------|-------------------------------|
| Nemotron 3 Super | free |
| Gemini 2.5 Flash Lite Preview 09-2025 | $0.10 / $0.40 |
| Gemini 3.1 Flash Lite | $0.25 / $1.50 |
| MiniMax M2.7 | $0.30 / $1.20 |
| DeepSeek V3.2 | $0.26 / $0.38 |
| GPT-5 Nano | $0.05 / $0.40 |

## Architecture

- **Main process** (`src/main/`) — planning pipeline, OpenRouter SDK wrapper, config/storage IPC, import parsers, debug logging.
- **Renderer** (`src/renderer/`) — React + FullCalendar UI.
- **Shared** (`src/shared/`) — TypeScript types.
- **Prompts** (`src/main/prompts/`) — markdown prompt files loaded at runtime.
- **Data** — saved plans, config, and debug logs stored in the OS user-data directory.

## Evaluation Strategy

The evaluator is a separate post-run model call, not another acceptance gate. It runs during benchmark runs (skipped on interactive planner runs). A single **fixed judge model** — chosen in Settings or via the benchmark's `--evaluator` flag — scores every model under test, so `model_score` is comparable across models instead of each model grading its own work. It receives the original student input, interpreter output, specialist views, selected final calendar, final critiques, validation log, and hard metrics, and writes a `ScheduleEvaluation` object into the JSON export.

The final score is:

```text
final_score = 50% model_score + 50% hard_score
```

The model score focuses on qualitative aspects such as coherence, actionability, compromise quality, and handling uncertainty. The hard score uses generation speed, rejections, critical issues, major issues, deadline violations, task coverage, and availability overrun.

For benchmarking, an additional deterministic scenario score is computed from `benchmarks/scenarios.json`. It checks:

- expected task/topic coverage;
- deadline discipline;
- availability discipline;
- fixed-commitment explanation;
- wellbeing/late-night respect;
- revision efficiency and quorum convergence.

The deterministic scorer emits labeled mistakes such as `missing_expected_task`, `block_after_deadline`, `availability_overrun`, `late_work_when_avoided`, `wellbeing_agent_rejected`, `max_iterations_fallback`, and `quorum_not_reached`. This makes prompt improvement iterative: inspect mistake labels, change prompts, rerun the same benchmark matrix, and compare the new `experiment.json`.

Each OpenRouter call is traced in the JSON export with schema name, model, prompt/completion tokens, latency, and estimated USD cost where pricing is known. When provider token usage is missing, token counts are conservatively estimated from character counts and marked as `usageSource: "estimated"`.

Older pulled benchmark results do not contain per-call token traces. The analytics view still gives them a cost estimate using model pricing and stored JSON artifact size, and marks those rows as `legacy_estimate`. Fresh `npm run benchmark` outputs use traced per-call usage when available.

The old one-model `batch` command was removed because the benchmark runner supersedes it: same purpose, but with matrices, deterministic mistakes, cost tracking, app integration, and richer artifacts.

## Prompt Strategy

- **v1 (initial)** — full context: agent views, student input, calendar, strategy.
- **v2+ (revision)** — compact: ultra-short calendar summary, critique tally, no agent views or raw input. Prevents truncation on long runs.
- **No rest/buffer blocks** — Wellbeing Agent recommends fewer/shorter work blocks, not scheduled breaks. Empty space is implicit rest.
- **No invented tasks** — Planner is forbidden from creating generic lifestyle blocks.
