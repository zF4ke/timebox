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

## Package for distribution

```bash
npm run dist
```

Output goes to `release/`. On Windows this produces a portable `.exe`. On macOS a `.dmg`. On Linux an `AppImage`.

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
- **Schedule Evaluator** scores the selected final calendar after acceptance. It is diagnostic only. The final evaluation is 50% model judgement and 50% deterministic hard metrics.
- **JSON export** = full audit trail with reasoning. **ICS export** = importable into Google/Apple Calendar.

## UI Features

- **Composer** — natural language input for tasks and constraints.
- **Live progress** — planning steps rendered newest-first with fade-by-age animation.
- **Cancel run** — abort an in-progress planning run.
- **Calendar view** — FullCalendar week grid with color-coded event types.
- **Event details** — click any calendar block to see description, reasoning, and timing.
- **Saved plans sidebar** — auto-saves plans, with load and delete.
- **Settings** — configurable quorum (1–5), max iterations (1–5), model picker with pricing, and OpenRouter API key. Persisted to the OS user-data directory.
- **Evaluation panel** — shows final score, model score, hard-metric score, each hard metric, dimension scores, strengths, weaknesses, and the planner/evaluator models used.
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

The evaluator is a separate post-run model call, not another acceptance gate. It receives the original student input, interpreter output, specialist views, selected final calendar, final critiques, validation log, and hard metrics. It writes a `ScheduleEvaluation` object into the JSON export.

The final score is:

```text
final_score = 50% model_score + 50% hard_score
```

The model score focuses on qualitative aspects such as coherence, actionability, compromise quality, and handling uncertainty. The hard score uses generation speed, rejections, critical issues, major issues, deadline violations, task coverage, and availability overrun.

## Prompt Strategy

- **v1 (initial)** — full context: agent views, student input, calendar, strategy.
- **v2+ (revision)** — compact: ultra-short calendar summary, critique tally, no agent views or raw input. Prevents truncation on long runs.
- **No rest/buffer blocks** — Wellbeing Agent recommends fewer/shorter work blocks, not scheduled breaks. Empty space is implicit rest.
- **No invented tasks** — Planner is forbidden from creating generic lifestyle blocks.
