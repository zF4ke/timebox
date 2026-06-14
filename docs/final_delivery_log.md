# Final Delivery Work Log

Chronological log for the final delivery benchmark and evaluation work.

## 2026-06-04

- Started from the project root (the repository checkout directory).
- Read the local `AGENTS.md` instructions and confirmed the project structure: Electron main process in `src/main`, React renderer in `src/renderer`, shared types in `src/shared`, prompt markdown files in `src/main/prompts`, and project documents in `docs`.
- Checked the initial git state: clean `master` tracking `origin/master`.
- Pulled colleague changes with `git pull --ff-only`, updating from `41188f4` to `e69e0c8`.
- Inspected the pulled benchmark attempt:
  - `prompts/*.txt` adds 15 fixed student inputs.
  - `results/*` stores existing model outputs and summary files.
  - `src/main/batch.ts` runs one model over prompt files and writes JSON/ICS plus simple summaries.
  - `src/main/metrics.ts` computes basic hard metrics for a final calendar.
  - `src/main/prompts/schedule-evaluator.md` adds an LLM schedule evaluator.
  - `tests/metrics.test.ts` covers the current hard metric calculation.
- Extracted the project requirement PDF and group presentation PDF using bundled Python and `pypdf`.
- Requirement takeaways:
  - Final delivery needs full source code, executable, README/run instructions, report, and a 7 minute presentation.
  - The report should include problem description, limitations, critical comparison between implementation alternatives, limitations of solutions/results/simulations, and possible improvements.
  - The course values MAS analysis, orchestration, cost/privacy/safety/ethical awareness, and the ability to justify every design choice.
- Presentation takeaways:
  - The project is framed as agent orchestration for student calendar planning.
  - The selected pattern is MACI-like: Planner creates a candidate calendar, specialist agents critique it, Planner revises it.
  - Evaluation should analyze quorum strictness, convergence, number of critique/revision rounds, and LLM call/cost efficiency.
- Current assessment:
  - The pulled benchmark code is useful baseline work, especially the input fixtures and stored run artifacts.
  - It is not yet strong enough for final delivery because it lacks an experiment matrix, deterministic scenario expectations, repeatability metadata, mistake classification, explicit free-model exclusion for benchmarking, and proper cost/usage tracking.
- Implementation plan:
  - Keep the existing prompt fixtures and results.
  - Add structured benchmark scenarios with difficulty, expected task names, behavioral expectations, and optional expected constraints.
  - Add deterministic scenario scoring and mistake labels independent of the LLM schedule evaluator.
  - Add an experiment runner over model/quorum/max-iteration matrices with manifest, raw artifacts, summaries, and aggregate analytics.
  - Track token usage and estimated cost per OpenRouter call where available; keep complete call traces in run JSON.
  - Add a separate analytics interface in the Electron app to inspect benchmark output without mixing it with the main planner workflow.
  - Exclude `:free` models from benchmark runs unless a CLI force flag is used.
- Added `benchmarks/scenarios.json` with 15 structured scenarios mapped to the existing prompt fixtures. Each scenario records difficulty, expected task/topic coverage, minimum work-block count, and whether late-night work should be avoided.
- Added `src/main/modelCosts.ts` for benchmark pricing metadata, free-model detection, conservative token estimation, and USD cost estimation.
- Updated `src/main/openrouter.ts` so every successful JSON call can emit a call trace with schema name, model, latency, prompt/completion size, token usage source, and estimated cost.
- Updated `src/main/planner.ts` so every planning result includes a `usage` summary with all LLM call traces.
- Added `src/main/benchmarkScoring.ts` for deterministic scenario scoring and labeled mistake extraction:
  - `missing_expected_task`
  - `block_after_deadline`
  - `deadline_task_unscheduled`
  - `availability_overrun`
  - `rest_block_not_allowed`
  - `fixed_commitments_not_explained`
  - `late_work_when_avoided`
  - `wellbeing_agent_rejected`
  - `max_iterations_fallback`
  - `quorum_not_reached`
  - `too_few_work_blocks`
- Added `src/main/benchmarkAnalytics.ts` to scan both legacy pulled `results/*` and new `benchmark-results/*` experiments, repair non-local artifact paths where possible, compute deterministic scores from stored JSON, and aggregate model/quorum/iteration performance.
- Added `src/main/benchmark.ts` as the new matrix benchmark CLI. It writes `manifest.json`, `experiment.json`, `summary.json`, `summary.csv`, raw run JSON, ICS files, deterministic mistake JSON, and error files.
- Added `npm run benchmark` to `package.json`.
- Added Electron IPC/preload support through `benchmark:list` and `window.plannerApi.listBenchmarkExperiments()`.
- Added shared benchmark and usage types in `src/shared/types.ts`.
- Added a separate renderer analytics mode with a Planner/Analytics switch, cost-benefit ranking table, latest-run table, token/cost display, deterministic score display, and mistake counts.
- Updated `README.md` with benchmark commands, output artifacts, free-model policy, analytics view, deterministic scoring methodology, and call-trace/cost behavior.
- Added `tests/benchmark-scoring.test.ts` covering successful deterministic scoring and labeled mistake extraction.
- Verification:
  - `npm test` passed: 4 test files, 11 tests.
  - `npm run typecheck` passed.
  - `npm run build` passed; Vite emitted only the existing large-chunk warning.
  - `node dist-electron\main\benchmark.js --help` passed without API use.
  - `node -e "...listBenchmarkExperiments..."` found 4 existing pulled result sets and confirmed analytics data is available without running new API calls.
- Frontend verification:
  - Started the Vite renderer on `http://127.0.0.1:5173`.
  - The first browser check exposed that the renderer crashed outside Electron because `window.plannerApi` is only injected by preload.
  - Added a browser-only fallback planner API so the UI can render in a normal browser for visual verification while Electron keeps using the real preload API.
  - Rechecked the browser DOM: Planner and Analytics modes render, and the Analytics empty state displays the benchmark command.
  - Captured a browser screenshot of the Analytics view for visual QA.
  - Reran `npm test` and `npm run build`; both passed.
- Executable packaging:
  - First `npm run dist` attempt reached electron-builder packaging but failed while extracting the Windows code-signing helper because the Windows account does not have symlink creation privilege.
  - Updated `package.json` Windows build config with `signAndEditExecutable: false`.
  - Reran `npm run dist`; it passed and produced the portable executable at `release\Timebox 0.1.0.exe`.
- Deliberately did not run a live benchmark matrix because that would spend OpenRouter credits. The benchmark runner is ready for controlled runs after choosing model/quorum/iteration values.
- Continuation audit improvement:
  - Found that legacy pulled runs could be quality-ranked but had blank cost-benefit fields because they predate usage tracing.
  - Added a clearly marked `legacy_estimate` cost source using stored JSON artifact size and known model pricing.
  - Fresh benchmark runs continue to use `traced` per-call cost when available.
  - Updated Analytics latest-run table, README, and architecture notes to distinguish traced costs from legacy estimates.
- Final packaging after continuation:
  - Reran `npm run dist` after the cost-source changes.
  - The stale `release\win-unpacked\resources\app.asar` file remained locked by Windows after a previous portable-app launch, so electron-builder could not reuse that directory.
  - Moved the configured electron-builder output directory to `release-current/` and updated the README.
  - Reran `npm run dist`; it passed and produced `release-current\Timebox 0.1.0.exe`.
  - Added `release-current/` to `.gitignore` so generated executable artifacts are not committed.
- Added `docs/benchmark_summary.md` with report-ready interpretation of the pulled baseline results:
  - Gemini 2.5 Flash Lite currently has the best deterministic/cost-benefit baseline.
  - Gemini 3.1 Flash Lite has the strongest average LLM evaluator score.
  - MiniMax has too many failed scenarios for a fair current comparison.
  - DeepSeek often fails quorum/convergence and leaves critical issues unresolved.
  - The summary lists common mistake labels and prompt improvement targets.
- Final verification after all continuation changes:
  - `npm test` passed: 4 test files, 11 tests.
  - `npm run build` passed, including renderer and Electron compilation.
  - Analytics scanner found 4 pulled result sets and ranked Gemini 2.5 Flash Lite as the top current cost-benefit baseline.
  - Verified executable exists at `release-current\Timebox 0.1.0.exe`.

## 2026-06-04 Follow-up UX and Cleanup

- Reviewed the colleague-added "evaluation" UI in the calendar view.
  - Kept the underlying Schedule Evaluator because it is useful for the project report and single-run quality inspection.
  - Renamed the visible calendar control from "Evaluation" / "eval" to "Quality" / "quality" to avoid internal wording in the user-facing app.
- Removed the old `src/main/batch.ts` script and the `npm run batch` package script.
  - Reason: it was redundant with the new benchmark runner and weaker than it. The new runner supports model/quorum/iteration matrices, deterministic mistake labels, cost tracing, app integration, and richer stored artifacts.
- Hid the Planner/Analytics tab switcher when the calendar result view is active.
- Added a green traced cost label to the calendar result header when `result.usage.estimatedCostUsd` is available.
- Refactored `src/main/benchmark.ts` so it can be used both as a CLI and as an Electron IPC runner.
- Added Electron benchmark IPC:
  - `benchmark:scenarios`
  - `benchmark:run`
  - `benchmark:cancel`
  - `benchmark:progress`
- Added preload/browser-fallback API methods for benchmark execution and progress.
- Added an in-app Analytics benchmark launcher:
  - non-free models only
  - quick/all scenario scope
  - quorum and max-iteration toggles
  - planned run count before start
  - progress stream and cancel button
- Updated packaging inputs so `benchmarks/`, `prompts/`, and `results/` are bundled with the executable.
- Updated benchmark fixture discovery so packaged builds can find benchmark scenarios and prompt fixtures.
- Final follow-up verification:
  - `npm run typecheck` passed.
  - `npm test` passed: 4 test files, 11 tests.
  - `npm run build` passed; Vite emitted only the existing large-chunk warning.
  - Browser visual QA confirmed the Analytics benchmark modal opens, excludes the free model, shows run count, and exposes start/cancel flow.
  - `node dist-electron\main\benchmark.js --help` passed without API use.
  - Scenario fixture discovery found all 15 benchmark scenarios from the compiled Electron output.
  - `npm run dist` passed and produced `release-current\Timebox 0.1.0.exe`.

## Planner / evaluation separation (2026-06-04)

Goal: keep the diagnostic "quality" score exclusive to the benchmarking section,
and remove score chrome from the Planner result view.

- Added `evaluate?: boolean` to `PlanningRequest` (defaults true for backward
  compatibility and benchmark runs). Interactive planner runs now pass
  `evaluate: false`, so the pipeline skips the LLM schedule-evaluator call —
  saving one model call (and its credits) on every normal plan.
- Made `PlanningResult.evaluation` optional. The planner pipeline only computes
  hard metrics + the evaluator when `evaluate !== false`.
- Benchmark runner (`okRun`) now reads `result.evaluation` defensively.
- App.tsx:
  - Removed the "Quality" dropdown and the entire schedule-evaluation panel from
    the Planner result header.
  - Removed the `·5/5 approvals·N issue(s) logged·quality X/5` metadata line.
    Kept the planning window and the green schedule cost.
  - Sidebar saved-plan rows now show the model only (no score).
  - Deleted now-dead helpers (`formatDimension`, `formatMetricName`,
    `formatMetricValue`) and the evaluation CSS block.
- Verification: `npm run typecheck`, `npm test` (11 passing), `npm run build` all passed.

## Evaluation fairness + analytics depth (2026-06-04)

Addressed the five gaps from the step-back review.

1. **Fixed judge model (the big one).**
   - `evaluatorModel` is no longer forced to equal the planner model. It now
     comes from config (`AppConfig.evaluatorModel`) / the benchmark request, and
     only falls back to the planner model when nothing is configured.
   - Added an **Evaluator (judge) selector in Settings** and in the **Run
     benchmark** modal. One fixed judge scores every model under test, so
     `model_score` is finally comparable across models.
   - `benchmark.runScenario` passes the fixed judge (not the model under test).
     The judge is stamped into each experiment + manifest + run summary.
2. **Mistake-improvement loop closed.**
   - `BenchmarkRunSummary` now carries `mistakes[]`. A new **Top mistakes** panel
     aggregates deterministic mistake codes across the latest experiment, sorted
     by frequency then severity — direct prompt-tuning targets.
3. **Charts.** Added a dependency-free inline-SVG **cost-vs-quality scatter**
   (`ScatterChart`) in Analytics; up-and-left is better.
4. **Prompt version stamp.** `promptsHash()` hashes the prompt `.md` files;
   stamped into `manifest.json`, the experiment object, and shown in the
   Analytics metric band so pre/post-tuning runs are distinguishable.
5. **Budget guard.** `BenchmarkRequest.maxBudgetUsd` + a CLI `--max-budget` flag.
   The runner tracks cumulative traced cost and stops before a run that would
   exceed the cap (`stoppedByBudget`). The run modal shows a rough pre-flight
   estimate and warns when it exceeds the entered cap.

CLI additions: `--evaluator <model>`, `--max-budget <usd>`.

Verification: `npm run typecheck`, `npm test` (11 passing), `npm run build` all
passed. Visual check confirmed the run modal renders the judge selector, budget
cap, live cost estimate, and the over-budget warning.

## Estimate calibration + repo cleanup + rebuild (2026-06-04)

- **Calibrated cost estimate.** The Run-benchmark modal now prefers the real
  average traced cost-per-run per model (computed from every stored experiment)
  and only falls back to the token heuristic for models with no history. A small
  basis label shows "from past runs" / "mixed" / "rough heuristic".
- **Codebase cleanup.**
  - Deleted dead UI scaffold: `src/renderer/components/ui/*` (badge, button,
    card, dialog, form) and `src/renderer/lib/utils.ts` — nothing imported them.
  - Removed the 7 now-unused dependencies they pulled in: `@radix-ui/react-dialog`,
    `@radix-ui/react-label`, `@radix-ui/react-separator`, `@radix-ui/react-slot`,
    `class-variance-authority`, `clsx`, `tailwind-merge`.
  - Consolidated the two release folders into a single `release/`
    (electron-builder output renamed from `release-current/`), updated README,
    and simplified `.gitignore`.
- **Rebuilt executable:** `release/Timebox 0.1.0.exe` (portable, ~90 MB).
- Verified: `npm run typecheck`, `npm test` (11 passing), `npm run build`,
  `npm run dist` all passed; browser check confirmed the calibrated estimate
  and basis label render.

## Requirements compliance check (2026-06-04)

Checked against `Project-AAMAS2026.pdf` (course) and the Group 45 proposal:
- Track = **Agent Orchestration**; reproduces the **MACI** core idea
  (planner → specialist critique → revision). ✓
- All 5 proposal objectives implemented (NL interpretation w/ current date,
  5 specialist agents, compromise reasoning, critique-driven revision,
  quorum + no-critical + hard-constraint acceptance). ✓
- Proposal's evaluation questions (quorum strictness/convergence, #revision
  rounds, LLM-call cost = agents × iterations × scenarios) are now measurable
  via the benchmark matrix. ✓
- Final-delivery artifacts: full source ✓, README run instructions ✓,
  executable ✓. **Still outstanding: the 4-page ACM report and 7-min
  presentation** (content-only deliverables, not code).

## Cost-vs-quality chart polish (2026-06-04)

Fixed the scatter chart based on review feedback (y-label overlapping the "100"
tick, no x-axis cost values, dots running to the edge):
- Y-axis label is now a rotated vertical caption ("← quality (0–100)"), well
  clear of the tick labels.
- Added x-axis cost tick values ($0 / mid / max) and a centered "cost per run
  (USD) →" caption.
- Added ~12% headroom on the cost axis so the costliest point isn't on the edge.
- Points are color-coded per model with a model legend below the chart, a numeric
  score label above each dot, and a "top-left is best" hint.
- Verified via DOM geometry in the browser (rotated label at x=18 vs "100" tick at
  x=54; cost ticks present; 4 color dots + 4-model legend) using a temporary
  in-memory fixture that was removed afterward.

## Sortable analytics tables + open-run-in-planner (2026-06-04)

- **Sortable tables.** Added a small generic sort layer (`useSortedRows` hook,
  `SortTh` header, `compareValues` with nulls-last and numeric-aware string
  compare). All three analytics tables (Top mistakes, Cost-benefit ranking,
  Latest runs) now sort on any column header, toggling asc/desc with an arrow
  indicator and `aria-sort`. Numeric columns are right-aligned and tabular.
- **Open a run's schedule in the Planner.** Each ok run in "Latest runs" has an
  "Open" button. New IPC `benchmark:openRun(jsonPath, icsPath)` reads the stored
  run JSON, reattaches `exports` from the json/ics files, and the renderer loads
  it as the current result and switches to the Planner tab.
  - Added `PlannerApi.openBenchmarkRun`, the preload binding, the main handler,
    and a browser-fallback stub.
- Verified in the browser with a temporary fixture (since removed): 3 tables,
  25 sortable headers, 3 Open buttons (errored run correctly shows none), and a
  Cost-column click reorders desc with nulls last (`aria-sort="descending"`).
- `npm run typecheck` + `npm test` (11 passing) pass; executable rebuilt.


## Clear-button fix + prompt browser + button animations (2026-06-04)

**Problem:** Pressing Clear in Benchmark analytics did not remove the data from the UI. Also,
the user asked to browse prompts inside the Benchmarking tab, and wanted animations on the
Refresh / Clear buttons.

### What changed

1. **Clear button now actually clears and reports errors.**
   - `clearBenchmarkExperiments()` in `benchmarkAnalytics.ts` now returns a
     `ClearBenchmarkResult { success, cleared[], errors[] }` instead of void.
   - The IPC handler (`main.ts`) returns this result.
   - `App.tsx` tracks `isClearing` state. The Clear button now:
     - Shows "Clearing…" + a pulsing animation while active.
     - Properly `await`s `onClear()` inside an async handler (was fire-and-forget before).
     - Alerts the user if any directory failed to delete (common on Windows/OneDrive locks).
     - Calls `refreshBenchmarks()` after clearing so the UI empties immediately.
   - Added `@keyframes pulse` and `.pulsing` class in `styles.css`.

2. **New Prompt browser modal in the Benchmarking tab.**
   - Two new IPC endpoints:
     - `prompts:list` — returns grouped prompt categories (scenario `.txt` files from
       `prompts/` and agent `.md` files from `src/main/prompts/`).
     - `prompts:read` — reads a prompt file with path-sanitization (only allows reads
       from the two allowed prompt directories).
   - Preload bindings added for both.
   - `PromptBrowserModal` component in `App.tsx`: sidebar with grouped file list, click
     to load and display the prompt content in a scrollable `<pre>` panel.
   - New "Prompts" button (with `BookOpen` icon) in the analytics header, next to Refresh
     and Clear.
   - CSS: `.prompt-browser`, `.prompt-browser-sidebar`, `.prompt-browser-content`, etc.

3. **Button animations.**
   - Refresh button: `.spinning` class applies `@keyframes spin` to the icon when a
     benchmark is running (visual feedback that something is happening).
   - Clear button: `.pulsing` class applies a gentle opacity pulse during the clear
     operation.
   - Both use CSS `transition` for smooth hover states (already existed, now enhanced
     with the new keyframes).

### Verification
- `npm run typecheck` — clean.
- `npm test` — 11 passing.
- `npm run build` — green.

## Defensive fixes for stale main process + prompt browser UX (2026-06-04)

**Problem:** User reported Clear and Refresh still showing experiments after clicking, and the
new Prompt browser modal stayed on "Loading…" forever with poor centering.

**Root cause:** `npm run dev` hot-reloads the renderer but keeps the Electron main process +
preload script from the previous launch. The renderer was running new code against stale IPC
handlers:
- `benchmark:clear` old handler returned `undefined` → new renderer code did `result.success`
  which threw before the refresh could happen.
- `prompts:list` didn't exist in the old main process → `plannerApi.listPrompts` was
  `undefined`, causing a synchronous throw that React didn't surface, leaving the modal stuck.

### What changed

1. **Backend deletion more robust.**
   - `clearBenchmarkExperiments` now uses `maxRetries: 10, retryDelay: 300` (was 5 × 200 ms).
   - After `fs.rmSync` it explicitly checks `fs.existsSync(dir)` again and reports an error if
     the directory is still present (Windows/OneDrive sometimes claims success but keeps the
     folder around briefly).

2. **Frontend Clear is defensive + optimistic.**
   - `clearBenchmarks()` now calls `setBenchmarkExperiments([])` immediately so the UI empties
     right away, even if the backend is slow or fails.
   - Handles stale main processes that return `undefined` instead of `ClearBenchmarkResult`.
   - Catches and alerts any unexpected errors.

3. **Prompt browser detects stale preload.**
   - `PromptBrowserModal` now checks `typeof plannerApi.listPrompts !== "function"` before
     calling it. If the method is missing, it shows a clear error message:
     *"Prompt browser requires a newer app version. Please restart the app (or npm run dev)
     so the main process picks up the latest IPC handlers."*
   - This prevents the synchronous throw that was freezing the modal.

4. **CSS fixes.**
   - `.prompt-browser-placeholder` now uses `display: flex; align-items: center;
     justify-content: center; height: 100%;` so "Loading…" and empty states are actually
     centered.
   - `.prompt-browser-error` now has a visible red-bordered box with background so error
     messages are readable.

### What the user needs to do
Because these changes touch **main-process IPC handlers and the preload script**, the Electron
main process must be restarted for them to take effect:
- If running `npm run dev`: stop it (`Ctrl+C`) and start it again.
- If running an older packaged `.exe`: rebuild or use the newer executable noted in the
  later packaging entry.

### Verification
- `npm run typecheck` — clean.
- `npm test` — 11 passing.

## Cost estimate, prompt tuning, icon, and alignment fixes (2026-06-04)

**Problem:** User observed that a benchmark estimated at about `$0.1874` only reduced
OpenRouter credits from `$3.95` to `$3.85`, asked whether the evaluator contributed to cost,
reported vertically misaligned icons/text in buttons, supplied deterministic mistake labels
for prompt improvement, and noted that the packaged app still used the default Electron icon.

### What changed

1. **Cost estimate clarification and fix.**
   - Confirmed traced benchmark cost already includes the schedule-evaluator call because
     every OpenRouter JSON call emits a `LlmCallTrace` and the planning result sums all
     traces.
   - Fixed the pre-flight benchmark estimate so the fixed evaluator/judge call is priced
     with the selected judge model, not implicitly with the planner model.
   - Calibrated historical estimates by planner-model + evaluator-model pair, so a run with
     one judge does not incorrectly calibrate estimates for another judge.
   - The modal estimate label now says it includes the fixed judge.

2. **Prompt tuning from top mistake labels.**
   - `base-system.md` now states that deadline work must end before the deadline, empty time
     is rest, and late-night work should be avoided when the student asks for that or signals
     low energy/stress.
   - Initial and revision planner prompts now repeat the deadline-end and late-night rules.
   - `deadline-agent.md` now treats deadlines literally and rejects post-deadline required
     work.
   - `wellbeing-agent.md` now recommends moving/shortening/dropping work rather than adding
     rest/buffer/contingency blocks.

3. **Scoring severity calibration.**
   - Kept true post-deadline work critical.
   - Downgraded moderate availability overrun, ordinary late-night avoidance misses,
     one-block deficits, one-vote quorum misses, and max-iteration fallback from major to
     minor where appropriate.
   - Wellbeing rejection severity now follows whether the underlying critique is severe.

4. **Button alignment.**
   - Centralized flex alignment for icon/text buttons including Refresh, Clear, Prompts,
     Cancel, Run benchmark, Open, and mode-switch buttons.

5. **Windows app icon.**
   - Generated `assets/app_icon.ico` from the existing PNG.
   - Added `win.icon` in `package.json`, bundled `assets/`, and passed the icon to
     `BrowserWindow`.
   - Added `app.setAppUserModelId("com.aasma.timebox")` on Windows for better taskbar
     identity.
   - Added `release-*/` to `.gitignore` for temporary ignored release outputs.

### Verification
- `npm run typecheck` — clean.
- `npm test` — 11 passing.
- `npm run build` — clean; Vite emitted only the existing large-chunk warning.
- Browser visual automation was attempted, but the bundled Playwright package in this
  runtime was incomplete (`playwright-core` missing), so screenshot verification could not
  run.
- `npm run dist` rebuilt source successfully but failed when OneDrive/Windows locked the old
  `release/win-unpacked/resources/app.asar` cleanup path.
- A clean `electron-builder` package succeeded outside OneDrive at
  `%TEMP%\timebox-release-codex`, and the resulting portable executable was copied to
  `release-new\Timebox 0.1.0.exe`.

## Scientifically fairer benchmark ranking (2026-06-04)

**Problem:** The Cost-benefit ranking mixed rows from different benchmark experiments
and used `deterministic_score / average_cost`, so small cost differences produced huge
value swings and configurations with more scenarios could look unfairly worse than
quick 3-scenario runs.

### What changed
- The ranking table now uses only the latest experiment's aggregates, so rows compare
  the same scenario set and run conditions.
- Renamed the table to "Latest experiment ranking".
- Replaced the raw per-dollar ratio with a bounded adjusted value:
  - deterministic score is the primary quality signal;
  - fixed-judge LLM score is secondary because it is less deterministic;
  - reliability, failed runs, critical mistakes, and non-critical mistakes affect the score;
  - cost is a tie-breaker instead of dominating the ranking.
- Added a short UI note explaining the adjusted value.

### Verification
- `npm run typecheck` — clean.
- `npm test` — 11 passing.
- `npm run build` — clean; Vite emitted only the existing large-chunk warning.

## Park prompt tuning for baseline benchmark (2026-06-04)

**Problem:** The prompt-tuning changes should not be active before the first controlled
benchmark run, otherwise the report would lose a clean before/after comparison.

### What changed
- Saved the prompt-tuning diff to
  `docs/patches/prompt_tuning_after_baseline.patch`.
- Reverted the live prompt/planner wording changes in:
  - `src/main/prompts/base-system.md`
  - `src/main/prompts/deadline-agent.md`
  - `src/main/prompts/wellbeing-agent.md`
  - `src/main/planner.ts`
- Kept non-prompt fixes active: evaluator-cost estimate fix, icon/text alignment,
  Windows icon packaging, and benchmark severity calibration.

### How to bring the prompt tuning back
- After the baseline benchmark is recorded, run:
  `git apply docs/patches/prompt_tuning_after_baseline.patch`
- Then rerun the same benchmark matrix so the report can compare baseline vs tuned prompts.

### Verification
- `git apply --check docs/patches/prompt_tuning_after_baseline.patch` — clean.
