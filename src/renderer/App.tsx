import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput, EventClickArg } from "@fullcalendar/core";
import {
  PanelLeft,
  Plus,
  Download,
  Save,
  ChevronDown,
  FileJson,
  Calendar as CalendarIcon,
  Check,
  X,
  Trash2,
  Settings,
  BarChart3,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  CalendarPlus,
  BookOpen
} from "lucide-react";
import type {
  AppConfig,
  BenchmarkAggregate,
  BenchmarkExperiment,
  BenchmarkMistake,
  BenchmarkProgressEvent,
  BenchmarkRequest,
  BenchmarkRunSummary,
  BenchmarkScenarioSummary,
  CalendarBlock,
  PlannerDefaults,
  PlanningRequest,
  PlanningResult,
  ProgressEvent,
  SavedCalendar
} from "../shared/types";

const SAMPLE_INPUT = `I have a DB lab due Tuesday night. It should be easy but I haven't started.
I have an AASMA proposal due Friday, worth 20%, and we still need to define the architecture.
I have an AI quiz on Thursday with two chapters to review.
I usually have classes in the morning and can work in the afternoon.
I slept badly yesterday.`;

const QUORUM_OPTIONS = [1, 2, 3, 4, 5];

const MODEL_OPTIONS = [
  "google/gemini-2.5-flash-lite-preview-09-2025",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemini-3.1-flash-lite-preview",
  "minimax/minimax-m2.7",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v4-flash",
  "openai/gpt-5-nano",
];

const BENCHMARK_MODEL_OPTIONS = MODEL_OPTIONS.filter((model) => !model.includes(":free"));
const BENCHMARK_SCENARIO_PRESETS = [3, 5, 8, 10, 15] as const;

const FALLBACK_BENCHMARK_SCENARIOS: BenchmarkScenarioSummary[] = [
  {
    id: "01_urgent_mixed_deadlines",
    promptFile: "01_urgent_mixed_deadlines.txt",
    difficulty: "medium",
    title: "Urgent mixed deadlines"
  },
  {
    id: "05_fixed_commitments_busy_week",
    promptFile: "05_fixed_commitments_busy_week.txt",
    difficulty: "challenging",
    title: "Fixed commitments busy week"
  },
  {
    id: "09_no_deadlines_self_study",
    promptFile: "09_no_deadlines_self_study.txt",
    difficulty: "easy",
    title: "No-deadline self study"
  }
];

const MODEL_INFO: Record<string, { name: string; price: string }> = {
  "google/gemini-2.5-flash-lite-preview-09-2025": { name: "Gemini 2.5 Flash Lite Preview 09-2025", price: "$0.10 / $0.40" },
  "google/gemini-3.1-flash-lite-preview": { name: "Gemini 3.1 Flash Lite", price: "$0.25 / $1.50" },
  "minimax/minimax-m2.7": { name: "MiniMax M2.7", price: "$0.30 / $1.20" },
  "deepseek/deepseek-v3.2": { name: "DeepSeek V3.2", price: "$0.26 / $0.38" },
  "deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash", price: "$0.0983 / $0.1966" },
  "openai/gpt-5-nano": { name: "GPT-5 Nano", price: "$0.05 / $0.40" },
  "nvidia/nemotron-3-super-120b-a12b:free": { name: "Nemotron 3 Super", price: "free" },
};

// Numeric pricing (USD per million tokens) mirroring src/main/modelCosts.ts.
// Used only for the pre-flight budget estimate; the authoritative cost guard
// runs in the benchmark process against real traced usage.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite-preview-09-2025": { input: 0.1, output: 0.4 },
  "google/gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.5 },
  "minimax/minimax-m2.7": { input: 0.3, output: 1.2 },
  "deepseek/deepseek-v3.2": { input: 0.26, output: 0.38 },
  "deepseek/deepseek-v4-flash": { input: 0.0983, output: 0.1966 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.4 }
};

// Rough per-run token profile for a full pipeline. Planner-model calls are
// interpreter + 5 specialists + planner drafts + critique rounds. The final
// schedule-evaluator call uses the fixed judge model, so price it separately.
function estimateRunCostUsd(model: string, maxIterations: number, evaluatorModel: string): number | null {
  const pricing = MODEL_PRICING[model];
  const evaluatorPricing = MODEL_PRICING[evaluatorModel];
  if (!pricing || !evaluatorPricing) return null;
  const plannerCalls = 1 + 5 + maxIterations + maxIterations * 5;
  const promptTokens = 7000;
  const completionTokens = 1800;
  const plannerCost =
    (plannerCalls * promptTokens / 1_000_000) * pricing.input +
    (plannerCalls * completionTokens / 1_000_000) * pricing.output;
  const evaluatorCost =
    (promptTokens / 1_000_000) * evaluatorPricing.input +
    (completionTokens / 1_000_000) * evaluatorPricing.output;
  return plannerCost + evaluatorCost;
}

function calibrationKey(model: string, evaluatorModel: string | null | undefined): string {
  return `${model}::${evaluatorModel ?? ""}`;
}

const plannerApi = window.plannerApi ?? createBrowserFallbackApi();

function isFreeModel(model: string | null | undefined): boolean {
  return Boolean(model?.includes(":free"));
}

function formatModel(model: string): React.ReactNode {
  const info = MODEL_INFO[model];
  if (!info) return model;
  if (!info.price) return info.name;
  return (
    <>
      <span>{info.name}</span>
      <span className="model-price">{info.price}</span>
    </>
  );
}



interface StepItem {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  summary?: string;
  startedAt?: number;
  endedAt?: number;
}

export default function App() {
  const [userInput, setUserInput] = useState(SAMPLE_INPUT);
  const [settings, setSettings] = useState<AppConfig>({ quorum: 5, model: MODEL_OPTIONS[0] });
  const [defaults, setDefaults] = useState<PlannerDefaults | null>(null);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [saved, setSaved] = useState<SavedCalendar[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [pendingDelete, setPendingDelete] = useState<SavedCalendar | null>(null);
  const [duplicateSavePending, setDuplicateSavePending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCount = useRef(0);
  const activeRunGeneration = useRef(0);
  const cancelledRunGeneration = useRef<number | null>(null);
  const [cancelledGeneration, setCancelledGeneration] = useState<number | null>(null);
  const [mode, setMode] = useState<"planner" | "analytics">("planner");
  const [benchmarkExperiments, setBenchmarkExperiments] = useState<BenchmarkExperiment[]>([]);
  const [benchmarkScenarios, setBenchmarkScenarios] = useState<BenchmarkScenarioSummary[]>([]);
  const [isClearing, setIsClearing] = useState(false);
  const [benchmarkEvents, setBenchmarkEvents] = useState<BenchmarkProgressEvent[]>([]);
  const activeBenchmarkGeneration = useRef(0);

  useEffect(() => {
    plannerApi.getDefaults().then(setDefaults);
    plannerApi.getConfig().then((c) => {
      setSettings(c);
    });
    refreshSaved();
    refreshBenchmarks();
    plannerApi.listBenchmarkScenarios().then(setBenchmarkScenarios);
  }, []);

  useEffect(() => {
    return plannerApi.onProgress((ev) => {
      if (ev.clientRunId && ev.clientRunId !== String(activeRunGeneration.current)) return;
      if (cancelledRunGeneration.current === activeRunGeneration.current) return;
      setSteps((prev) => applyProgress(prev, ev));
    });
  }, []);

  useEffect(() => {
    return plannerApi.onBenchmarkProgress((ev) => {
      if (ev.clientRunId && ev.clientRunId !== String(activeBenchmarkGeneration.current)) return;
      setBenchmarkEvents((prev) => [ev, ...prev].slice(0, 80));
    });
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCount.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCount.current--;
      if (dragCount.current <= 0) {
        setIsDragging(false);
        dragCount.current = 0;
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCount.current = 0;
      setIsDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "json" || ext === "ics") {
          const text = await file.text();
          try {
            const imported = await plannerApi.parseImport(text, file.name);
            setResult(imported);
            refreshSaved();
          } catch (err) {
            console.error("Import failed:", err);
          }
          break;
        }
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function refreshSaved() {
    const calendars = await plannerApi.listCalendars();
    setSaved(calendars);
    return calendars;
  }

  async function refreshBenchmarks() {
    const experiments = await plannerApi.listBenchmarkExperiments();
    setBenchmarkExperiments(experiments);
    return experiments;
  }

  async function clearBenchmarks() {
    setIsClearing(true);
    // Optimistically empty the UI so the user sees immediate feedback.
    setBenchmarkExperiments([]);
    try {
      const result = await plannerApi.clearBenchmarkExperiments();
      // Defensive: old main processes return undefined instead of ClearBenchmarkResult.
      if (result && typeof result === "object" && !result.success) {
        alert(`Clear partially failed:\n${result.errors.join("\n")}`);
      }
    } catch (err) {
      alert(`Clear failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsClearing(false);
      await refreshBenchmarks();
    }
  }

  const plannerMutation = useMutation({
    mutationFn: ({ request, generation }: { request: PlanningRequest; generation: number }) =>
      plannerApi.runPlanner(request, String(generation)),
    onSuccess: (res, variables) => {
      if (variables.generation !== activeRunGeneration.current) return;
      if (cancelledRunGeneration.current === variables.generation) return;
      setResult(res);
      void refreshSaved();
    }
  });

  const benchmarkMutation = useMutation({
    mutationFn: ({ request, generation }: { request: BenchmarkRequest; generation: number }) =>
      plannerApi.runBenchmark(request, String(generation)),
    onSuccess: (experiment, variables) => {
      if (variables.generation !== activeBenchmarkGeneration.current) return;
      setBenchmarkExperiments((prev) => [experiment, ...prev.filter((candidate) => candidate.id !== experiment.id)]);
      void refreshBenchmarks();
    }
  });

  const taskNameMap = useMemo<Record<string, string>>(() => {
    if (!result) return {};
    const map: Record<string, string> = {};
    for (const task of result.interpreterOutput.tasks) {
      if (task.task_id && task.name) map[task.task_id] = task.name;
    }
    for (const day of result.finalCalendar.days) {
      for (const block of day.blocks) {
        if (block.task_id && block.task_name) map[block.task_id] = block.task_name;
      }
    }
    return map;
  }, [result]);

  const events = useMemo<EventInput[]>(() => {
    if (!result) return [];
    return result.finalCalendar.days.flatMap((day) =>
      day.blocks.map((block) => ({
        id: block.id,
        title: humanize(block.task_name ?? block.description, taskNameMap),
        start: block.start,
        end: block.end,
        classNames: [`event-${block.type ?? "work"}`, "ev-clickable"],
        extendedProps: { block }
      }))
    );
  }, [result, taskNameMap]);

  const isRunning = plannerMutation.isPending && cancelledGeneration !== activeRunGeneration.current;
  const error =
    cancelledGeneration !== activeRunGeneration.current && plannerMutation.error instanceof Error
      ? plannerMutation.error.message
      : "";
  const initialDate = result?.finalCalendar.planning_window.start_date ?? new Date().toISOString().slice(0, 10);
  const savedCurrentResult = useMemo(() => {
    if (!result) return null;
    return saved.find((calendar) => calendar.result.runId === result.runId) ?? null;
  }, [result, saved]);
  const displayedSaveStatus = saveStatus === "idle" && savedCurrentResult ? "saved" : saveStatus;

  function runPlanner() {
    activeRunGeneration.current += 1;
    cancelledRunGeneration.current = null;
    setCancelledGeneration(null);
    setResult(null);
    setSteps([]);
    setSaveStatus("idle");
    setDuplicateSavePending(false);
    plannerMutation.reset();
    const request: PlanningRequest = {
      userInput,
      quorum: settings.quorum,
      maxIterations: settings.maxIterations,
      model: settings.model,
      // Quality scoring is exclusive to the benchmarking section.
      evaluate: false
    };
    plannerMutation.mutate({ request, generation: activeRunGeneration.current });
  }

  async function handleSettingsChange(next: AppConfig) {
    setSettings(next);
    await plannerApi.setConfig(next);
    const d = await plannerApi.getDefaults();
    setDefaults(d);
  }

  function cancelPlanner() {
    const generation = activeRunGeneration.current;
    cancelledRunGeneration.current = generation;
    setCancelledGeneration(generation);
    setSteps([]);
    plannerMutation.reset();
    void plannerApi.cancelPlanner().catch((err) => {
      console.error("Cancel failed:", err);
    });
  }

  function runBenchmark(request: BenchmarkRequest) {
    activeBenchmarkGeneration.current += 1;
    setBenchmarkEvents([]);
    benchmarkMutation.reset();
    benchmarkMutation.mutate({ request, generation: activeBenchmarkGeneration.current });
  }

  function cancelBenchmark() {
    void plannerApi.cancelBenchmark().catch((err) => {
      console.error("Benchmark cancel failed:", err);
    });
    benchmarkMutation.reset();
  }

  function reset() {
    setResult(null);
    setSteps([]);
    setSaveStatus("idle");
    setDuplicateSavePending(false);
    plannerMutation.reset();
  }

  async function handleImport() {
    const imported = await plannerApi.importFile();
    if (imported) {
      setResult(imported);
      refreshSaved();
    }
  }

  async function handleLoad(savedCal: SavedCalendar) {
    const loaded = await plannerApi.loadCalendar(savedCal.id);
    if (loaded) {
      setResult(loaded.result);
      setSteps([]);
      setSaveStatus("idle");
      setDuplicateSavePending(false);
      plannerMutation.reset();
      setSidebarOpen(false);
    }
  }

  async function handleOpenBenchmarkRun(run: BenchmarkRunSummary) {
    if (!run.jsonPath) return;
    const loaded = await plannerApi.openBenchmarkRun(run.jsonPath, run.icsPath);
    if (loaded) {
      setResult(loaded);
      setSteps([]);
      setSaveStatus("idle");
      setDuplicateSavePending(false);
      plannerMutation.reset();
      setMode("planner");
    } else {
      alert("Could not open this benchmark run. The stored JSON artifact was not found or could not be parsed.");
    }
  }

  function handleRequestDelete(cal: SavedCalendar) {
    setPendingDelete(cal);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    await plannerApi.deleteCalendar(pendingDelete.id);
    setPendingDelete(null);
    refreshSaved();
  }

  function handleSave() {
    if (!result) return;
    if (savedCurrentResult) {
      setDuplicateSavePending(true);
      return;
    }
    openSavePrompt();
  }

  function openSavePrompt() {
    setSaveStatus("idle");
    setSavePromptOpen(true);
  }

  function handleConfirmDuplicateSave() {
    setDuplicateSavePending(false);
    openSavePrompt();
  }

  async function handleConfirmSave(name: string) {
    if (!result) return;
    setSaveStatus("saving");
    const savedCalendar = await plannerApi.saveCalendar(name, result);
    setSaved((prev) => [savedCalendar, ...prev]);
    setSaveStatus("saved");
    void refreshSaved();
    setTimeout(() => {
      setSavePromptOpen(false);
      setSaveStatus("idle");
    }, 700);
  }

  let content: React.ReactNode;
  if (mode === "analytics") {
    content = (
      <AnalyticsView
        experiments={benchmarkExperiments}
        scenarios={benchmarkScenarios}
        defaultEvaluator={defaults?.evaluatorModel ?? settings.evaluatorModel ?? settings.model}
        onRefresh={refreshBenchmarks}
        onClear={clearBenchmarks}
        isClearing={isClearing}
        onRunBenchmark={runBenchmark}
        onCancelBenchmark={cancelBenchmark}
        onOpenRun={handleOpenBenchmarkRun}
        isBenchmarkRunning={benchmarkMutation.isPending}
        benchmarkEvents={benchmarkEvents}
        benchmarkError={benchmarkMutation.error instanceof Error ? benchmarkMutation.error.message : ""}
      />
    );
  } else if (isRunning || (steps.length > 0 && !result && error === "")) {
    content = <RunningView steps={steps} onCancel={cancelPlanner} />;
  } else if (result) {
    content = (
      <ResultView
        result={result}
        events={events}
        initialDate={initialDate}
        onReset={reset}
        onSave={handleSave}
        saveStatus={displayedSaveStatus}
        taskNameMap={taskNameMap}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  } else {
    content = (
      <ComposerView
        userInput={userInput}
        setUserInput={setUserInput}
        defaults={defaults}
        model={settings.model}
        error={error}
        onRun={runPlanner}
      />
    );
  }

  return (
    <>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-zone">
            <Download size={32} />
            <span>Drop JSON or ICS file here</span>
          </div>
        </div>
      )}
      <AppLayout
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        saved={saved}
        onImport={handleImport}
        onLoad={handleLoad}
        onDelete={handleRequestDelete}
        onOpenSettings={() => setSettingsOpen(true)}
        showSettings={!result}
        showModeSwitch={!(result && mode === "planner")}
        mode={mode}
        onSetMode={setMode}
      >
        {content}
      </AppLayout>

      {savePromptOpen && (
        <SavePromptModal
          status={saveStatus}
          onConfirm={handleConfirmSave}
          onClose={() => {
            if (saveStatus !== "saving") setSavePromptOpen(false);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete plan?"
          message={`"${pendingDelete.name}" will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {duplicateSavePending && (
        <ConfirmModal
          title="Save another copy?"
          message={`"${savedCurrentResult?.name ?? "This plan"}" is already saved. Saving again will create a duplicate copy.`}
          confirmLabel="Save another copy"
          onConfirm={handleConfirmDuplicateSave}
          onCancel={() => setDuplicateSavePending(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          defaults={defaults}
          onChange={handleSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

function AppLayout({
  children,
  sidebarOpen,
  setSidebarOpen,
  saved,
  onImport,
  onLoad,
  onDelete,
  onOpenSettings,
  showSettings = true,
  showModeSwitch = true,
  mode,
  onSetMode
}: {
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  saved: SavedCalendar[];
  onImport: () => void;
  onLoad: (c: SavedCalendar) => void;
  onDelete: (c: SavedCalendar) => void;
  onOpenSettings: () => void;
  showSettings?: boolean;
  showModeSwitch?: boolean;
  mode: "planner" | "analytics";
  onSetMode: (mode: "planner" | "analytics") => void;
}) {
  return (
    <div className="app-layout">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h3>Saved plans</h3>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <button className="import-btn" onClick={onImport}>
          Import JSON / ICS
        </button>
        <div className="saved-list">
          {saved.length === 0 && (
            <div className="saved-empty">No saved plans yet.</div>
          )}
          {saved.map((cal) => (
            <div key={cal.id} className="saved-item">
              <button className="saved-name" onClick={() => onLoad(cal)} title={cal.name}>
                <span>{cal.name}</span>
                <small>
                  {formatCompactModel(cal.result.request.model ?? "unknown model")}
                </small>
              </button>
              <button
                className="saved-delete"
                onClick={() => onDelete(cal)}
                title="Delete"
                aria-label="Delete plan"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="main-area">
        <button
          className={`floating-toggle ${sidebarOpen ? "hidden" : ""}`}
          onClick={() => setSidebarOpen(true)}
          title="Saved plans"
          aria-label="Open saved plans"
        >
          <PanelLeft size={16} />
        </button>
        {showSettings && (
          <button
            className="floating-toggle floating-toggle-right"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={16} />
          </button>
        )}
        {showModeSwitch && (
          <div className="mode-switch" role="tablist" aria-label="App view">
            <button
              className={mode === "planner" ? "active" : ""}
              onClick={() => onSetMode("planner")}
              role="tab"
              aria-selected={mode === "planner"}
              title="Planner"
            >
              <CalendarIcon size={14} />
              <span>Planner</span>
            </button>
            <button
              className={mode === "analytics" ? "active" : ""}
              onClick={() => onSetMode("analytics")}
              role="tab"
              aria-selected={mode === "analytics"}
              title="Benchmarks"
            >
              <BarChart3 size={14} />
              <span>Analytics</span>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function createBrowserFallbackApi(): typeof window.plannerApi {
  return {
    async runPlanner() {
      throw new Error("Planner runs require the Electron app.");
    },
    async cancelPlanner() {
      return undefined;
    },
    async getDefaults() {
      return {
        quorum: 5,
        maxIterations: 3,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        model: MODEL_OPTIONS[0],
        evaluatorModel: MODEL_OPTIONS[0],
        hasApiKey: false
      };
    },
    onProgress() {
      return () => undefined;
    },
    async listCalendars() {
      return [];
    },
    async saveCalendar() {
      throw new Error("Saving plans requires the Electron app.");
    },
    async loadCalendar() {
      return null;
    },
    async deleteCalendar() {
      return false;
    },
    async importFile() {
      return null;
    },
    async getConfig() {
      return { quorum: 5, model: MODEL_OPTIONS[0], maxIterations: 3 };
    },
    async setConfig() {
      return undefined;
    },
    async parseImport() {
      throw new Error("Importing files requires the Electron app.");
    },
    async listBenchmarkExperiments() {
      return [];
    },
    async openBenchmarkRun() {
      return null;
    },
    async clearBenchmarkExperiments() {
      return { success: true, cleared: [], errors: [] };
    },
    async listBenchmarkScenarios() {
      return FALLBACK_BENCHMARK_SCENARIOS;
    },
    async listPrompts() {
      return [];
    },
    async readPrompt() {
      return "";
    },
    async runBenchmark() {
      throw new Error("Benchmark runs require the Electron app.");
    },
    async cancelBenchmark() {
      return undefined;
    },
    onBenchmarkProgress() {
      return () => undefined;
    }
  };
}

type SortDir = "asc" | "desc";
interface SortState {
  key: string;
  dir: SortDir;
}
type SortValue = string | number | null;
type Accessors<T> = Record<string, (row: T) => SortValue>;

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, challenging: 2 };
const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2 };

function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  // Nulls always sort last, regardless of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const raw =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true });
  return dir === "asc" ? raw : -raw;
}

function useSortedRows<T>(rows: T[], accessors: Accessors<T>, initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b), sort.dir));
    // accessors is a stable module-level const, safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const onSort = (key: string) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  return { sorted, sort, onSort };
}

function SortTh({
  label,
  field,
  sort,
  onSort,
  align
}: {
  label: string;
  field: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: "right";
}) {
  const active = sort.key === field;
  return (
    <th
      className={`sortable${active ? " active" : ""}${align === "right" ? " num" : ""}`}
      onClick={() => onSort(field)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="th-inner">
        <span>{label}</span>
        {active ? (
          sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="th-idle" />
        )}
      </span>
    </th>
  );
}

type RankingRow = BenchmarkAggregate & { experimentId: string };

const RANKING_ACCESSORS: Accessors<RankingRow> = {
  model: (r) => formatCompactModel(r.model),
  quorum: (r) => r.quorum,
  maxIterations: (r) => r.maxIterations,
  okCount: (r) => r.okCount,
  averageDeterministicScore: (r) => r.averageDeterministicScore,
  averageOverallScore: (r) => r.averageOverallScore,
  averageCostUsd: (r) => r.averageCostUsd,
  averageTokens: (r) => r.averageTokens,
  mistakes: (r) => r.criticalMistakes * 1000 + r.totalMistakes,
  costBenefitScore: (r) => r.costBenefitScore
};

const RUN_ACCESSORS: Accessors<BenchmarkRunSummary> = {
  scenarioTitle: (r) => r.scenarioTitle,
  difficulty: (r) => DIFFICULTY_RANK[r.difficulty] ?? 99,
  model: (r) => formatCompactModel(r.model),
  quorum: (r) => r.quorum,
  iterations: (r) => r.iterations,
  status: (r) => r.status,
  deterministicScore: (r) => r.deterministicScore,
  overallScore: (r) => r.overallScore,
  estimatedCostUsd: (r) => r.estimatedCostUsd,
  costSource: (r) => r.costSource,
  mistakes: (r) => r.criticalMistakeCount * 1000 + r.mistakeCount
};

interface MistakeRow {
  code: string;
  severity: BenchmarkMistake["severity"];
  count: number;
  example: string;
}

const MISTAKE_ACCESSORS: Accessors<MistakeRow> = {
  code: (r) => r.code,
  severity: (r) => SEVERITY_RANK[r.severity] ?? 99,
  count: (r) => r.count,
  example: (r) => r.example
};

function AnalyticsView({
  experiments,
  scenarios,
  defaultEvaluator,
  onRefresh,
  onClear,
  isClearing,
  onRunBenchmark,
  onCancelBenchmark,
  onOpenRun,
  isBenchmarkRunning,
  benchmarkEvents,
  benchmarkError
}: {
  experiments: BenchmarkExperiment[];
  scenarios: BenchmarkScenarioSummary[];
  defaultEvaluator: string;
  onRefresh: () => void;
  onClear: () => void;
  isClearing: boolean;
  onRunBenchmark: (request: BenchmarkRequest) => void;
  onCancelBenchmark: () => void;
  onOpenRun: (run: BenchmarkRunSummary) => void;
  isBenchmarkRunning: boolean;
  benchmarkEvents: BenchmarkProgressEvent[];
  benchmarkError: string;
}) {
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [promptBrowserOpen, setPromptBrowserOpen] = useState(false);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>("");
  const previousLatestExperimentId = useRef<string>("");
  const latest = experiments[0];
  const selectedExperiment = experiments.find((experiment) => experiment.id === selectedExperimentId) ?? latest;
  const selectedRuns = selectedExperiment?.runs ?? [];
  const selectedAggregates = useMemo(
    () => (selectedExperiment?.aggregates ?? []).map((aggregate) => ({ ...aggregate, experimentId: selectedExperiment?.id ?? "latest" })),
    [selectedExperiment]
  );

  useEffect(() => {
    if (experiments.length === 0) {
      setSelectedExperimentId("");
      previousLatestExperimentId.current = "";
      return;
    }
    const nextLatestId = experiments[0].id;
    const wasShowingLatest = !selectedExperimentId || selectedExperimentId === previousLatestExperimentId.current;
    if (wasShowingLatest || !experiments.some((experiment) => experiment.id === selectedExperimentId)) {
      setSelectedExperimentId(nextLatestId);
    }
    previousLatestExperimentId.current = nextLatestId;
  }, [experiments, selectedExperimentId]);

  const best = selectedAggregates
    .filter((aggregate) => aggregate.okCount > 0)
    .sort((a, b) => {
      const aScore = a.costBenefitScore ?? a.averageDeterministicScore ?? -1;
      const bScore = b.costBenefitScore ?? b.averageDeterministicScore ?? -1;
      return bScore - aScore;
    })
    .slice(0, 8);

  // Aggregate deterministic mistake labels across the latest experiment so the
  // most common failure modes are obvious targets for prompt tuning.
  const topMistakes = useMemo(() => {
    const counts = new Map<string, { code: string; severity: BenchmarkMistake["severity"]; count: number; example: string }>();
    for (const run of selectedRuns) {
      for (const mistake of run.mistakes ?? []) {
        const existing = counts.get(mistake.code);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(mistake.code, { code: mistake.code, severity: mistake.severity, count: 1, example: mistake.message });
        }
      }
    }
    const severityRank = { critical: 0, major: 1, minor: 2 } as const;
    return Array.from(counts.values()).sort(
      (a, b) => b.count - a.count || severityRank[a.severity] - severityRank[b.severity]
    );
  }, [selectedRuns]);

  // Calibrate the pre-flight cost estimate from real traced runs: average the
  // actual cost per ok run per planner/judge model pair across every experiment.
  // Far more accurate than the token heuristic once matching real data exists.
  const costCalibration = useMemo(() => {
    const sums = new Map<string, { cost: number; count: number }>();
    for (const experiment of experiments) {
      for (const run of experiment.runs) {
        if (run.status !== "ok" || run.costSource !== "traced" || typeof run.estimatedCostUsd !== "number") continue;
        const key = calibrationKey(run.model, run.evaluatorModel);
        const entry = sums.get(key) ?? { cost: 0, count: 0 };
        entry.cost += run.estimatedCostUsd;
        entry.count += 1;
        sums.set(key, entry);
      }
    }
    const result: Record<string, number> = {};
    for (const [key, entry] of sums) {
      if (entry.count > 0) result[key] = entry.cost / entry.count;
    }
    return result;
  }, [experiments]);

  // Points for the cost-vs-quality scatter (one per config in the best list).
  const scatterPoints = best
    .filter((aggregate) => typeof aggregate.averageCostUsd === "number" && typeof aggregate.averageDeterministicScore === "number")
    .map((aggregate) => ({
      model: aggregate.model,
      label: `${formatCompactModel(aggregate.model)} · Q${aggregate.quorum} · ${aggregate.maxIterations} iter`,
      cost: aggregate.averageCostUsd as number,
      score: aggregate.averageDeterministicScore as number
    }));

  const ranking = useSortedRows(best, RANKING_ACCESSORS, { key: "costBenefitScore", dir: "desc" });
  const runs = useSortedRows(selectedRuns, RUN_ACCESSORS, { key: "scenarioTitle", dir: "asc" });
  const mistakes = useSortedRows(topMistakes, MISTAKE_ACCESSORS, { key: "count", dir: "desc" });

  return (
    <main className="analytics-shell">
      <header className="analytics-header">
        <div>
          <h1>Benchmark analytics</h1>
          <p className="subtitle">
            Model quality, quorum strictness, iteration cost, and deterministic mistake labels.
          </p>
        </div>
        <div className="analytics-actions">
          <button
            className={`btn-secondary ${isBenchmarkRunning ? "spinning" : ""}`}
            onClick={onRefresh}
            disabled={isBenchmarkRunning}
            title="Refresh experiment list"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button
            className={`btn-secondary ${isClearing ? "pulsing" : ""}`}
            onClick={async () => {
              if (window.confirm("Clear all benchmark analytics? This permanently deletes stored results.")) {
                try {
                  await onClear();
                } catch {
                  // Errors are surfaced by the clear handler; no-op here to avoid unhandled rejection.
                }
              }
            }}
            disabled={isBenchmarkRunning || isClearing || experiments.length === 0}
            title="Clear all stored benchmark results"
          >
            <Trash2 size={14} />
            <span>{isClearing ? "Clearing…" : "Clear"}</span>
          </button>
          <button
            className="btn-secondary"
            onClick={() => setPromptBrowserOpen(true)}
            title="Browse scenario and agent prompts"
          >
            <BookOpen size={14} />
            <span>Prompts</span>
          </button>
          {isBenchmarkRunning ? (
            <button className="btn-danger" onClick={onCancelBenchmark}>
              <X size={14} />
              <span>Cancel</span>
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setRunModalOpen(true)}>
              <BarChart3 size={14} />
              <span>Run benchmark</span>
            </button>
          )}
        </div>
      </header>

      {(isBenchmarkRunning || benchmarkEvents.length > 0 || benchmarkError) && (
        <section className="benchmark-progress">
          <div className="benchmark-progress-head">
            <span>{isBenchmarkRunning ? "Benchmark running" : benchmarkError ? "Benchmark error" : "Latest benchmark activity"}</span>
            <strong>
              {benchmarkEvents[0] ? `${benchmarkEvents[0].current}/${benchmarkEvents[0].total}` : "-"}
            </strong>
          </div>
          {benchmarkError && <div className="err">{benchmarkError}</div>}
          <div className="benchmark-events">
            {benchmarkEvents.slice(0, 6).map((event, index) => (
              <div className={`benchmark-event event-phase-${event.phase}`} key={`${event.timestamp}-${index}`}>
                <span>{formatBenchmarkPhase(event.phase)}</span>
                <p>{event.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {experiments.length === 0 ? (
        <div className="analytics-empty">
          No benchmark runs yet. Click <strong>Run benchmark</strong> above to start a matrix comparison.
        </div>
      ) : (
        <>
          <section className="metric-band">
            <div>
              <span className="metric-label">Experiments</span>
              <strong>{experiments.length}</strong>
            </div>
            <div>
              <span className="metric-label">Runs</span>
              <strong>{experiments.reduce((sum, experiment) => sum + experiment.runs.length, 0)}</strong>
            </div>
            <div>
              <span className="metric-label">Best deterministic</span>
              <strong>{formatNullable(best[0]?.averageDeterministicScore, "")}</strong>
            </div>
            <div>
              <span className="metric-label">Judge</span>
              <strong>{selectedExperiment?.evaluatorModel ? formatCompactModel(selectedExperiment.evaluatorModel) : "mixed"}</strong>
            </div>
            <div>
              <span className="metric-label">Prompts</span>
              <strong>{selectedExperiment?.promptHash ?? "—"}</strong>
            </div>
          </section>

          <section className="analytics-section">
            <div className="section-title-row">
              <h2>Benchmark run</h2>
              <span>{selectedExperiment?.id === latest?.id ? "latest selected" : "historical run selected"}</span>
            </div>
            <div className="experiment-browser">
              <label htmlFor="benchmark-experiment-select">Experiment</label>
              <select
                id="benchmark-experiment-select"
                value={selectedExperiment?.id ?? ""}
                onChange={(event) => setSelectedExperimentId(event.target.value)}
              >
                {experiments.map((experiment, index) => (
                  <option key={experiment.id} value={experiment.id}>
                    {index === 0 ? "Latest · " : ""}{formatExperimentOption(experiment)}
                  </option>
                ))}
              </select>
              <div className="experiment-summary">
                <span>{selectedExperiment?.runs.length ?? 0} runs</span>
                <span>{selectedExperiment?.aggregates.length ?? 0} configurations</span>
                <span>{selectedExperiment?.createdAt ? formatDateTime(selectedExperiment.createdAt) : "—"}</span>
              </div>
            </div>
          </section>

          <section className="analytics-section">
            <div className="section-title-row">
              <h2>Cost vs quality</h2>
              <span>{scatterPoints.length} configuration{scatterPoints.length === 1 ? "" : "s"}</span>
            </div>
            <ScatterChart points={scatterPoints} />
          </section>

          {topMistakes.length > 0 && (
            <section className="analytics-section">
              <div className="section-title-row">
                <h2>Top mistakes</h2>
                <span>selected run · prompt-tuning targets</span>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortTh label="Mistake" field="code" sort={mistakes.sort} onSort={mistakes.onSort} />
                      <SortTh label="Severity" field="severity" sort={mistakes.sort} onSort={mistakes.onSort} />
                      <SortTh label="Count" field="count" sort={mistakes.sort} onSort={mistakes.onSort} align="right" />
                      <SortTh label="Example" field="example" sort={mistakes.sort} onSort={mistakes.onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {mistakes.sorted.map((mistake) => (
                      <tr key={mistake.code}>
                        <td>{mistake.code}</td>
                        <td><span className={`status-pill severity-${mistake.severity}`}>{mistake.severity}</span></td>
                        <td className="num">{mistake.count}</td>
                        <td className="mistake-example">{mistake.example}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="analytics-section">
            <div className="section-title-row">
              <h2>Experiment ranking</h2>
              <span>same scenario set · deterministic-first adjusted value</span>
            </div>
            <p className="section-note">
              Adjusted value weights deterministic score most, uses the fixed judge as secondary evidence, penalizes failures and critical mistakes, and treats cost as a tie-breaker.
            </p>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortTh label="Model" field="model" sort={ranking.sort} onSort={ranking.onSort} />
                    <SortTh label="Q" field="quorum" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Iter" field="maxIterations" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Runs" field="okCount" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Deterministic" field="averageDeterministicScore" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="LLM score" field="averageOverallScore" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Avg cost" field="averageCostUsd" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Tokens" field="averageTokens" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Mistakes" field="mistakes" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                    <SortTh label="Adjusted value" field="costBenefitScore" sort={ranking.sort} onSort={ranking.onSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {ranking.sorted.map((aggregate) => (
                    <tr key={`${aggregate.experimentId}-${aggregate.model}-${aggregate.quorum}-${aggregate.maxIterations}`}>
                      <td>{formatCompactModel(aggregate.model)}</td>
                      <td className="num">{aggregate.quorum}</td>
                      <td className="num">{aggregate.maxIterations}</td>
                      <td className="num">{aggregate.okCount}/{aggregate.runCount}</td>
                      <td className="num">{formatNullable(aggregate.averageDeterministicScore, "%")}</td>
                      <td className="num">{formatNullable(aggregate.averageOverallScore, "/5")}</td>
                      <td className="num">{formatCost(aggregate.averageCostUsd)}</td>
                      <td className="num">{formatNumber(aggregate.averageTokens)}</td>
                      <td className="num">{aggregate.criticalMistakes} crit / {aggregate.totalMistakes} total</td>
                      <td className="num">{formatNullable(aggregate.costBenefitScore, "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="analytics-section">
            <div className="section-title-row">
              <h2>Runs</h2>
              <span>{selectedExperiment?.id}</span>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortTh label="Scenario" field="scenarioTitle" sort={runs.sort} onSort={runs.onSort} />
                    <SortTh label="Difficulty" field="difficulty" sort={runs.sort} onSort={runs.onSort} />
                    <SortTh label="Model" field="model" sort={runs.sort} onSort={runs.onSort} />
                    <SortTh label="Q" field="quorum" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <SortTh label="Iter" field="iterations" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <SortTh label="Status" field="status" sort={runs.sort} onSort={runs.onSort} />
                    <SortTh label="Deterministic" field="deterministicScore" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <SortTh label="Score" field="overallScore" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <SortTh label="Cost" field="estimatedCostUsd" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <SortTh label="Cost source" field="costSource" sort={runs.sort} onSort={runs.onSort} />
                    <SortTh label="Mistakes" field="mistakes" sort={runs.sort} onSort={runs.onSort} align="right" />
                    <th aria-label="Open in planner" />
                  </tr>
                </thead>
                <tbody>
                  {runs.sorted.map((run) => (
                    <tr key={`${run.model}-${run.quorum}-${run.maxIterations}-${run.scenarioId}`}>
                      <td>{run.scenarioTitle}</td>
                      <td>{run.difficulty}</td>
                      <td>{formatCompactModel(run.model)}</td>
                      <td className="num">{run.quorum}</td>
                      <td className="num">{run.iterations ?? "-"}</td>
                      <td>
                        <span className={`status-pill status-${run.status}`}>{run.status}</span>
                      </td>
                      <td className="num">{formatNullable(run.deterministicScore, "%")}</td>
                      <td className="num">{formatNullable(run.overallScore, "/5")}</td>
                      <td className="num">{formatCost(run.estimatedCostUsd)}</td>
                      <td>{formatCostSource(run.costSource)}</td>
                      <td className="num">{run.criticalMistakeCount} crit / {run.mistakeCount} total</td>
                      <td className="row-action">
                        {run.status === "ok" && run.jsonPath ? (
                          <button
                            type="button"
                            className="open-run-btn"
                            onClick={() => onOpenRun(run)}
                            title="Open this schedule in the Planner"
                          >
                            <CalendarPlus size={13} />
                            <span>Open</span>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {runModalOpen && (
        <BenchmarkRunModal
          scenarios={scenarios}
          defaultEvaluator={defaultEvaluator}
          costCalibration={costCalibration}
          onClose={() => setRunModalOpen(false)}
          onRun={(request) => {
            setRunModalOpen(false);
            onRunBenchmark(request);
          }}
        />
      )}
      {promptBrowserOpen && (
        <PromptBrowserModal
          onClose={() => setPromptBrowserOpen(false)}
        />
      )}
    </main>
  );
}

const CHART_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7"];

function ScatterChart({ points }: { points: Array<{ model: string; label: string; cost: number; score: number }> }) {
  if (points.length === 0) {
    return <div className="chart-empty">No traced cost/score pairs yet.</div>;
  }

  const width = 680;
  const height = 300;
  const pad = { left: 64, right: 28, top: 24, bottom: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Give the costliest point ~12% headroom so it never sits on the right edge.
  const maxCost = Math.max(...points.map((p) => p.cost), 0.0001) * 1.12;
  const x = (cost: number) => pad.left + (cost / maxCost) * plotW;
  const y = (score: number) => pad.top + (1 - score / 100) * plotH; // score is 0–100

  // Stable color per distinct model.
  const models = Array.from(new Set(points.map((p) => p.model)));
  const colorOf = (model: string) => CHART_PALETTE[models.indexOf(model) % CHART_PALETTE.length];

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [0, maxCost / 2, maxCost];
  const axisY = height - pad.bottom;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="scatter" role="img" aria-label="Cost versus deterministic quality">
        {/* horizontal gridlines + y ticks */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} y1={y(tick)} x2={width - pad.right} y2={y(tick)} className="grid" />
            <text x={pad.left - 10} y={y(tick) + 3} textAnchor="end" className="tick">{tick}</text>
          </g>
        ))}

        {/* x ticks (cost) */}
        {xTicks.map((tick, i) => (
          <text key={i} x={x(tick)} y={axisY + 18} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} className="tick">
            {formatCost(tick)}
          </text>
        ))}

        {/* axes */}
        <line x1={pad.left} y1={axisY} x2={width - pad.right} y2={axisY} className="axis" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={axisY} className="axis" />

        {/* axis labels */}
        <text x={pad.left + plotW / 2} y={height - 8} textAnchor="middle" className="axis-label">cost per run (USD) →</text>
        <text
          transform={`rotate(-90, 18, ${pad.top + plotH / 2})`}
          x={18}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          className="axis-label"
        >
          ← quality (0–100)
        </text>

        {/* points */}
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={x(point.cost)} cy={y(point.score)} r={6} className="dot" style={{ fill: colorOf(point.model) }}>
              <title>{`${point.label}\n${formatCost(point.cost)} · ${Math.round(point.score)}/100`}</title>
            </circle>
            <text x={x(point.cost)} y={y(point.score) - 11} textAnchor="middle" className="dot-label">
              {Math.round(point.score)}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-footer">
        <div className="chart-legend-models">
          {models.map((model) => (
            <span key={model} className="legend-item">
              <span className="legend-swatch" style={{ background: colorOf(model) }} />
              {formatCompactModel(model)}
            </span>
          ))}
        </div>
        <span className="chart-hint">Top-left is best: higher quality, lower cost.</span>
      </div>
    </div>
  );
}

function BenchmarkRunModal({
  scenarios,
  defaultEvaluator,
  costCalibration,
  onRun,
  onClose
}: {
  scenarios: BenchmarkScenarioSummary[];
  defaultEvaluator: string;
  costCalibration: Record<string, number>;
  onRun: (request: BenchmarkRequest) => void;
  onClose: () => void;
}) {
  const [models, setModels] = useState<string[]>([
    "google/gemini-2.5-flash-lite-preview-09-2025",
    "google/gemini-3.1-flash-lite-preview"
  ]);
  const [quorums, setQuorums] = useState<number[]>([3, 5]);
  const [iterations, setIterations] = useState<number[]>([2, 3]);
  const [scenarioLimit, setScenarioLimit] = useState<number>(5);
  const [evaluatorModel, setEvaluatorModel] = useState<string>(
    BENCHMARK_MODEL_OPTIONS.includes(defaultEvaluator) ? defaultEvaluator : BENCHMARK_MODEL_OPTIONS[0]
  );
  const [budget, setBudget] = useState<string>("");
  const scenarioPresetOptions = BENCHMARK_SCENARIO_PRESETS.filter((count) => count < scenarios.length);
  const selectedScenarios = scenarios.slice(0, Math.min(scenarioLimit, scenarios.length));
  const runCount = models.length * quorums.length * iterations.length * selectedScenarios.length;

  // Pre-flight estimate. Prefer real per-model cost calibrated from past traced
  // runs; fall back to the token heuristic for models with no history. The real
  // cap is still enforced against traced usage during the run.
  const estimate = useMemo(() => {
    let total = 0;
    let known = true;
    let calibrated = false;
    let heuristic = false;
    for (const model of models) {
      const calibratedCost = costCalibration[calibrationKey(model, evaluatorModel)];
      for (const iter of iterations) {
        let perRun: number | null;
        if (typeof calibratedCost === "number") {
          perRun = calibratedCost;
          calibrated = true;
        } else {
          perRun = estimateRunCostUsd(model, iter, evaluatorModel);
          if (perRun !== null) heuristic = true;
        }
        if (perRun === null) {
          known = false;
          continue;
        }
        total += perRun * quorums.length * selectedScenarios.length;
      }
    }
    return { total, known, calibrated, heuristic };
  }, [models, iterations, quorums.length, selectedScenarios.length, costCalibration, evaluatorModel]);

  const budgetValue = budget.trim() === "" ? null : Number(budget);
  const budgetInvalid = budgetValue !== null && (!Number.isFinite(budgetValue) || budgetValue <= 0);
  const overBudget = budgetValue !== null && !budgetInvalid && estimate.known && estimate.total > budgetValue;
  const disabled = runCount === 0 || budgetInvalid;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    onRun({
      models,
      quorums,
      maxIterations: iterations,
      scenarios: selectedScenarios.map((scenario) => scenario.id),
      retries: 1,
      delayMs: 0,
      forceFree: false,
      evaluatorModel,
      maxBudgetUsd: budgetValue ?? undefined
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <div>
            <h3>Run benchmark</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body benchmark-modal-body">
          <div className="benchmark-run-count">
            <div>
              <span>Planned runs</span>
              <strong>{runCount}</strong>
            </div>
            <div>
              <span>Est. cost</span>
              <strong className={overBudget ? "over-budget" : ""}>
                {estimate.known ? `≈ ${formatCost(estimate.total)}` : "unknown"}
              </strong>
              <small className="estimate-basis">
                {estimate.calibrated && !estimate.heuristic
                  ? "from past runs"
                  : estimate.calibrated && estimate.heuristic
                    ? "mixed: past runs + heuristic"
                    : "rough heuristic"} · includes fixed judge
              </small>
            </div>
          </div>

          <div className="field">
            <span className="meta-label">Scenario count</span>
            <div className="segmented segmented-wrap">
              {scenarioPresetOptions.map((count) => (
                <button
                  type="button"
                  key={count}
                  className={scenarioLimit === count ? "active" : ""}
                  onClick={() => setScenarioLimit(count)}
                >
                  {count}
                </button>
              ))}
              <button
                type="button"
                className={scenarioLimit >= scenarios.length ? "active" : ""}
                onClick={() => setScenarioLimit(scenarios.length)}
              >
                All ({scenarios.length})
              </button>
            </div>
            <div className="field-hint">
              Uses the first {selectedScenarios.length} fixture{selectedScenarios.length === 1 ? "" : "s"} from the fixed benchmark set.
            </div>
          </div>

          <div className="field">
            <span className="meta-label">Models</span>
            <div className="check-grid">
              {BENCHMARK_MODEL_OPTIONS.map((model) => (
                <label key={model} className="check-row">
                  <input
                    type="checkbox"
                    checked={models.includes(model)}
                    onChange={() => setModels((prev) => toggleValue(prev, model))}
                  />
                  <span>{formatCompactModel(model)}</span>
                </label>
              ))}
            </div>
            <div className="field-hint">Free models are intentionally excluded from app benchmarks.</div>
          </div>

          <div className="benchmark-options-row">
            <div className="field">
              <span className="meta-label">Quorum</span>
              <div className="check-inline">
                {[3, 5].map((value) => (
                  <label key={value} className="check-row compact">
                    <input
                      type="checkbox"
                      checked={quorums.includes(value)}
                      onChange={() => setQuorums((prev) => toggleValue(prev, value).sort())}
                    />
                    <span>{value}/5</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="meta-label">Max iterations</span>
              <div className="check-inline">
                {[2, 3].map((value) => (
                  <label key={value} className="check-row compact">
                    <input
                      type="checkbox"
                      checked={iterations.includes(value)}
                      onChange={() => setIterations((prev) => toggleValue(prev, value).sort())}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="benchmark-options-row">
            <div className="field">
              <span className="meta-label">Evaluator (judge)</span>
              <Dropdown
                value={evaluatorModel}
                options={BENCHMARK_MODEL_OPTIONS}
                onChange={setEvaluatorModel}
                format={(m) => formatCompactModel(m)}
              />
              <div className="field-hint">One fixed judge scores every model so results stay comparable.</div>
            </div>

            <div className="field">
              <label className="meta-label" htmlFor="benchmark-budget">Budget cap (USD)</label>
              <input
                id="benchmark-budget"
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="no cap"
              />
              <div className="field-hint">Optional. The matrix stops before a run that would exceed this.</div>
            </div>
          </div>

          {budgetInvalid && <div className="warn">Budget cap must be a positive number.</div>}
          {overBudget && (
            <div className="warn">
              Estimated cost ({formatCost(estimate.total)}) exceeds your cap ({formatCost(budgetValue!)}). The run will stop early when the cap is hit.
            </div>
          )}

          {scenarios.length === 0 && (
            <div className="warn">No benchmark scenarios were found. Check benchmarks/scenarios.json.</div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={disabled}>
            <BarChart3 size={14} />
            <span>Start {runCount} run{runCount === 1 ? "" : "s"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function PromptBrowserModal({ onClose }: { onClose: () => void }) {
  const [categories, setCategories] = useState<{ name: string; category: "scenario" | "agent"; prompts: { name: string; path: string; category: "scenario" | "agent" }[] }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    if (typeof plannerApi.listPrompts !== "function") {
      if (mounted) {
        setError("Prompt browser requires a newer app version. Please restart the app (or npm run dev) so the main process picks up the latest IPC handlers.");
        setIsLoading(false);
      }
      return;
    }
    plannerApi.listPrompts().then((data) => {
      if (mounted) {
        setCategories(data);
        setIsLoading(false);
      }
    }).catch((err) => {
      if (mounted) {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  async function handleSelect(path: string) {
    setSelected(path);
    setContentLoading(true);
    setError("");
    try {
      const text = await plannerApi.readPrompt(path);
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setContent("");
    } finally {
      setContentLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel prompt-browser">
        <header className="modal-header">
          <h2>Browse prompts</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="prompt-browser-body">
          <aside className="prompt-browser-sidebar">
            {isLoading && <div className="prompt-browser-loading">Loading…</div>}
            {!isLoading && error && categories.length === 0 && (
              <div className="prompt-browser-error">{error}</div>
            )}
            {!isLoading && categories.length === 0 && !error && (
              <div className="prompt-browser-empty">No prompts found.</div>
            )}
            {!isLoading && categories.map((cat) => (
              <div key={cat.category} className="prompt-browser-category">
                <div className="prompt-browser-category-title">{cat.name}</div>
                <ul className="prompt-browser-list">
                  {cat.prompts.map((p) => (
                    <li key={p.path}>
                      <button
                        className={`prompt-browser-file ${selected === p.path ? "active" : ""}`}
                        onClick={() => handleSelect(p.path)}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </aside>
          <main className="prompt-browser-content">
            {selected == null && (
              <div className="prompt-browser-placeholder">
                Select a prompt file from the sidebar to view its contents.
              </div>
            )}
            {contentLoading && <div className="prompt-browser-placeholder">Loading…</div>}
            {!contentLoading && selected != null && (
              <pre className="prompt-browser-pre">{content}</pre>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function ComposerView({
  userInput,
  setUserInput,
  defaults,
  model,
  error,
  onRun
}: {
  userInput: string;
  setUserInput: (v: string) => void;
  defaults: PlannerDefaults | null;
  model: string;
  error: string;
  onRun: () => void;
}) {
  const [isPlanning, setIsPlanning] = useState(false);

  function handleRun() {
    if (isPlanning) return;
    setIsPlanning(true);
    setTimeout(() => {
      onRun();
    }, 400);
  }

  return (
    <main className="shell">
      <div className="composer">
        <h1>What's on your plate?</h1>
        <p className="subtitle">Describe your tasks, deadlines, and availability.</p>

        <textarea
          className="input"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="e.g. I have a DB lab due Tuesday..."
          spellCheck={false}
          disabled={isPlanning}
        />

        <div className="row row-end">
          <button
            className={`run ${isPlanning ? "planning" : ""}`}
            onClick={handleRun}
            disabled={!userInput.trim() || !defaults?.hasApiKey || isPlanning}
          >
            {isPlanning ? (
              <>
                <span className="btn-spinner" />
                <span>Planning…</span>
              </>
            ) : (
              "Plan my week"
            )}
          </button>
        </div>

        {defaults && !defaults.hasApiKey && (
          <div className="warn">Set your OpenRouter API key in Settings to run the planner.</div>
        )}

        {isFreeModel(model) && (
          <div className="warn">
            Free OpenRouter models are really, really slow and will probably timeout.
          </div>
        )}

        {error && <div className="err">{error}</div>}
      </div>
    </main>
  );
}

function RunningView({ steps, onCancel }: { steps: StepItem[]; onCancel: () => void }) {
  const errorStep = steps.find((s) => s.status === "error");
  const reversed = useMemo(() => [...steps].reverse(), [steps]);
  const [isStopping, setIsStopping] = useState(false);

  function handleCancel() {
    if (isStopping) return;
    setIsStopping(true);
    setTimeout(() => {
      onCancel();
    }, 400);
  }

  return (
    <main className="shell">
      <div className="composer running">
        <div className="running-header">
          <div>
            <h1>{errorStep ? "Something went wrong" : "Planning your week"}</h1>
            <p className="subtitle">
              {errorStep ? errorStep.summary : "Agents are reasoning. Check the terminal for full logs."}
            </p>
          </div>
          {!errorStep && (
            <button
              className={`cancel-btn ${isStopping ? "stopping" : ""}`}
              onClick={handleCancel}
              disabled={isStopping}
            >
              {isStopping ? (
                <>
                  <span className="btn-spinner" />
                  <span>Stopping…</span>
                </>
              ) : (
                "Cancel run"
              )}
            </button>
          )}
        </div>

        <div className="steps steps-stack">
          {reversed.map((step, i) => {
            // Newest (i=0) is fully opaque; older steps fade gradually but stay readable.
            const opacity = Math.max(0.3, 1 - i * 0.12);
            return <StepRow key={step.key} step={step} opacity={opacity} />;
          })}
        </div>
      </div>
    </main>
  );
}

function StepRow({ step, opacity }: { step: StepItem; opacity: number }) {
  const elapsed =
    step.startedAt && step.endedAt ? `${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s` : "";

  return (
    <div className={`step step-${step.status}`} style={{ opacity }}>
      <div className="step-icon">
        {step.status === "active" && <span className="spinner" />}
        {step.status === "done" && <Check size={14} />}
        {step.status === "pending" && <span className="dot-pending" />}
        {step.status === "error" && <X size={14} />}
      </div>
      <div className="step-body">
        <div className="step-title">
          <span>{step.label}</span>
          {elapsed && <span className="step-time">{elapsed}</span>}
        </div>
        {step.summary && <div className="step-summary">{step.summary}</div>}
      </div>
    </div>
  );
}

function applyProgress(prev: StepItem[], ev: ProgressEvent): StepItem[] {
  const now = Date.parse(ev.timestamp) || Date.now();

  if (ev.phase === "error") {
    const errorStep: StepItem = {
      key: "error",
      label: "Error",
      status: "error",
      summary: ev.summary,
      endedAt: now
    };
    return [...prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const, endedAt: now } : s)), errorStep];
  }

  if (ev.phase === "complete") {
    return prev.map((s) =>
      s.status === "active" ? { ...s, status: "done" as const, endedAt: now } : s
    );
  }

  const key = stepKey(ev);
  const label = stepLabel(ev);
  const idx = prev.findIndex((s) => s.key === key);

  if (ev.status === "start") {
    const next: StepItem = {
      key,
      label,
      status: "active",
      summary: ev.summary,
      startedAt: now
    };
    if (idx === -1) return [...prev, next];
    const copy = [...prev];
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }

  // status === "done"
  if (idx === -1) {
    return [
      ...prev,
      {
        key,
        label,
        status: "done",
        summary: ev.summary,
        startedAt: now,
        endedAt: now
      }
    ];
  }
  const copy = [...prev];
  copy[idx] = {
    ...copy[idx],
    status: "done",
    summary: ev.summary ?? copy[idx].summary,
    endedAt: now
  };
  return copy;
}

function stepKey(ev: ProgressEvent): string {
  if (ev.phase === "specialist" && ev.agent) return `specialist:${ev.agent}`;
  if (ev.phase === "specialist") return "specialist:overall";
  if (ev.phase === "planner") return `planner:${ev.iteration ?? 0}`;
  if (ev.phase === "critique" && ev.agent) return `critique:${ev.iteration ?? 0}:${ev.agent}`;
  if (ev.phase === "critique") return `critique:${ev.iteration ?? 0}`;
  if (ev.phase === "validate") return `validate:${ev.iteration ?? 0}`;
  if (ev.phase === "decision") return `decision:${ev.iteration ?? 0}`;
  return ev.phase;
}

function stepLabel(ev: ProgressEvent): string {
  switch (ev.phase) {
    case "interpreter":
      return "Interpreting input";
    case "specialist":
      return ev.agent ? ev.agent : "Specialist agents";
    case "planner":
      return `Drafting calendar${ev.iteration ? ` v${ev.iteration}` : ""}`;
    case "critique":
      return ev.agent
        ? `${ev.agent} review${ev.iteration ? ` v${ev.iteration}` : ""}`
        : `Critique round${ev.iteration ? ` v${ev.iteration}` : ""}`;
    case "validate":
      return `Review issues${ev.iteration ? ` v${ev.iteration}` : ""}`;
    case "evaluate":
      return `Evaluating schedule${ev.iteration ? ` v${ev.iteration}` : ""}`;
    case "decision":
      return "Decision";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
}

function ResultView({
  result,
  events,
  initialDate,
  onReset,
  onSave,
  saveStatus,
  taskNameMap,
  onOpenSettings
}: {
  result: PlanningResult;
  events: EventInput[];
  initialDate: string;
  onReset: () => void;
  onSave: () => void;
  saveStatus: "idle" | "saving" | "saved";
  taskNameMap: Record<string, string>;
  onOpenSettings: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [concernsOpen, setConcernsOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState<CalendarBlock | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const concernsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen && !concernsOpen) return;
    const close = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
      if (concernsRef.current && !concernsRef.current.contains(e.target as Node)) {
        setConcernsOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen, concernsOpen]);

  const approvals = result.critiques.filter(
    (c) => c.approval === "approve" || c.approval === "approve_with_minor_concerns"
  ).length;
  const runCost = result.usage?.estimatedCostUsd;

  const handleEventClick = (arg: EventClickArg) => {
    const block = arg.event.extendedProps.block as CalendarBlock | undefined;
    if (block) setActiveBlock(block);
  };

  return (
    <main className="result-shell">
      <header className="result-header">
        <div className="result-title">
          <h2>Plan</h2>
          <p>
            {formatWindow(result.finalCalendar.planning_window.start_date, result.finalCalendar.planning_window.end_date)}
            {typeof runCost === "number" && (
              <>
                <span className="dot">·</span>
                <span className="schedule-cost">cost {formatCost(runCost)}</span>
              </>
            )}
          </p>
        </div>
        <div className="actions">
          <div className="agent-notes-wrap" ref={concernsRef}>
            <button
              className="agent-notes-trigger"
              onClick={() => setConcernsOpen((v) => !v)}
              aria-expanded={concernsOpen}
              aria-haspopup="menu"
              title="Agent concerns"
            >
              Agent notes
              <ChevronDown size={11} className={`chev ${concernsOpen ? "open" : ""}`} />
            </button>
            {concernsOpen && (
              <div className="agent-notes-menu" role="menu">
                <div className="agent-notes-head">
                  <span>Agent concerns</span>
                  <span>{approvals}/5 approved</span>
                </div>
                {result.critiques.map((critique) => {
                  const concerns = critique.critiques.length > 0
                    ? critique.critiques.map((issue) => ({
                        text: issue.issue,
                        severity: issue.severity,
                        fix: issue.suggested_fix
                      }))
                    : [{
                        text: critique.overall_comment || "No specific concern logged.",
                        severity: critique.severity,
                        fix: ""
                      }];

                  return (
                    <div className="agent-note" key={critique.agent}>
                      <div className="agent-note-top">
                        <strong>{critique.agent.replace(" Agent", "")}</strong>
                        <span className={`agent-note-badge severity-${critique.severity}`}>
                          {critique.approval.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div className="agent-note-list">
                        {concerns.map((concern, index) => (
                          <div className="agent-note-item" key={`${critique.agent}-${index}`}>
                            <p>{humanize(concern.text, taskNameMap)}</p>
                            {concern.fix && <span>{humanize(concern.fix, taskNameMap)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            className={`btn-secondary save-btn save-${saveStatus}`}
            onClick={onSave}
            disabled={saveStatus === "saving"}
            title="Save this plan"
          >
            {saveStatus === "saved" ? <Check size={14} /> : <Save size={14} />}
            <span>{saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Save"}</span>
          </button>

          <div className="export-wrap" ref={exportRef}>
            <button
              className="btn-secondary"
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
            >
              <Download size={14} />
              <span>Export</span>
              <ChevronDown size={12} className={`chev ${exportOpen ? "open" : ""}`} />
            </button>
            {exportOpen && (
              <div className="menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    downloadFile("plan.json", result.exports.json, "application/json");
                    setExportOpen(false);
                  }}
                >
                  <FileJson size={14} />
                  <div>
                    <div className="menu-label">JSON</div>
                    <div className="menu-sub">Full plan with reasoning</div>
                  </div>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    downloadFile("plan.ics", result.exports.ics, "text/calendar");
                    setExportOpen(false);
                  }}
                >
                  <CalendarIcon size={14} />
                  <div>
                    <div className="menu-label">ICS</div>
                    <div className="menu-sub">Import into Google / Apple Calendar</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button className="btn-primary" onClick={onReset} title="Start a new plan">
            <Plus size={14} />
            <span>New</span>
          </button>

          <button
            className="icon-btn"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="calendar-wrap">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "timeGridWeek,timeGridDay,dayGridMonth"
          }}
          initialDate={initialDate}
          events={events}
          nowIndicator
          allDaySlot={false}
          slotMinTime="07:00:00"
          slotMaxTime="23:00:00"
          height="100%"
          eventClick={handleEventClick}
          eventContent={(arg) => {
            const block = arg.event.extendedProps.block as CalendarBlock | undefined;
            return (
              <div className="ev">
                <strong>{arg.event.title}</strong>
                {block?.description && <span>{humanize(block.description, taskNameMap)}</span>}
              </div>
            );
          }}
        />
      </section>

      {activeBlock && (
        <BlockModal
          block={activeBlock}
          taskNameMap={taskNameMap}
          onClose={() => setActiveBlock(null)}
        />
      )}
    </main>
  );
}

function BlockModal({
  block,
  taskNameMap,
  onClose
}: {
  block: CalendarBlock;
  taskNameMap: Record<string, string>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = new Date(block.start);
  const end = new Date(block.end);
  const dateLabel = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
  const timeLabel = `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <span className={`badge badge-${block.type}`}>{block.type}</span>
            <h3>{humanize(block.task_name ?? block.description, taskNameMap)}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="modal-meta">
            <div>
              <div className="meta-label">When</div>
              <div>{dateLabel}</div>
              <div className="meta-sub">{timeLabel} · {block.duration_hours}h</div>
            </div>
          </div>
          <div className="modal-section">
            <div className="meta-label">Description</div>
            <p>{humanize(block.description, taskNameMap)}</p>
          </div>
          {block.reasoning && (
            <div className="modal-section">
              <div className="meta-label">Reasoning</div>
              <p>{humanize(block.reasoning, taskNameMap)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

function formatCompactModel(model: string): string {
  return MODEL_INFO[model]?.name ?? model;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatExperimentOption(experiment: BenchmarkExperiment): string {
  const modelCount = new Set(experiment.runs.map((run) => run.model)).size;
  const runLabel = `${experiment.runs.length} run${experiment.runs.length === 1 ? "" : "s"}`;
  const modelLabel = `${modelCount} model${modelCount === 1 ? "" : "s"}`;
  return `${formatDateTime(experiment.createdAt)} · ${runLabel} · ${modelLabel}`;
}

function formatNullable(value: number | null | undefined, suffix: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function formatCost(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(4)}`;
}

function formatCostSource(value: "traced" | "legacy_estimate" | null | undefined): string {
  if (value === "traced") return "traced";
  if (value === "legacy_estimate") return "estimated";
  return "-";
}

function formatBenchmarkPhase(phase: BenchmarkProgressEvent["phase"]): string {
  const labels: Record<BenchmarkProgressEvent["phase"], string> = {
    start: "Start",
    run_start: "Running",
    run_done: "Done",
    run_error: "Issue",
    complete: "Complete",
    error: "Error"
  };
  return labels[phase];
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return Math.round(value).toLocaleString();
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

// Replace any leftover task IDs (T1, T12, etc.) with the task's human name.
// Belt-and-braces: prompts already tell agents not to use IDs in user-facing text,
// but free models occasionally slip up.
function humanize(text: string | null | undefined, map: Record<string, string>): string {
  if (!text) return text ?? "";
  if (Object.keys(map).length === 0) return text;
  return text.replace(/\bT\d+\b/g, (match) => map[match] ?? match);
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function SavePromptModal({
  status,
  onConfirm,
  onClose
}: {
  status: "idle" | "saving" | "saved";
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const defaultName = useMemo(
    () =>
      `Plan · ${new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })}`,
    []
  );
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "saving") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "saving") return;
    const trimmed = name.trim() || defaultName;
    onConfirm(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={status === "saving" ? undefined : onClose}>
      <form
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <div>
            <h3>Save plan</h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={status === "saving"}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="meta-label">Name</div>
          <input
            ref={inputRef}
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Plan name"
            disabled={status === "saving"}
          />
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={status === "saving"}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`btn-primary save-btn save-${status}`}
            disabled={status === "saving" || status === "saved"}
          >
            {status === "saved" ? <Check size={14} /> : <Save size={14} />}
            <span>{status === "saved" ? "Saved" : status === "saving" ? "Saving…" : "Save"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  format
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  format?: (v: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = (v: T) => (format ? format(v) : String(v));

  return (
    <div className="dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-label">{label(value)}</span>
        <ChevronDown size={14} className={`chev ${open ? "open" : ""}`} />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu"
            role="listbox"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {options.map((opt) => {
              const selected = opt === value;
              return (
                <button
                  key={String(opt)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`dropdown-option ${selected ? "selected" : ""}`}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                >
                  <span className="dropdown-label">{label(opt)}</span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

function SettingsModal({
  settings,
  defaults,
  onChange,
  onClose
}: {
  settings: AppConfig;
  defaults: PlannerDefaults | null;
  onChange: (s: AppConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(settings);
  const [status, setStatus] = useState<"idle" | "saved">("idle");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "saved") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "saved") return;
    onChange(draft);
    setStatus("saved");
    setTimeout(() => {
      setStatus("idle");
      onClose();
    }, 700);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-md"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <div>
            <h3>Settings</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="field">
            <span className="meta-label">Approvals required</span>
            <Dropdown
              value={draft.quorum}
              options={QUORUM_OPTIONS}
              onChange={(n) => setDraft({ ...draft, quorum: n })}
              format={(n) => `${n} of 5`}
            />
            <div className="field-hint">How many specialist agents must approve before a calendar is accepted.</div>
          </div>

          <div className="field">
            <span className="meta-label">Max iterations</span>
            <Dropdown
              value={draft.maxIterations ?? defaults?.maxIterations ?? 3}
              options={[1, 2, 3, 4, 5]}
              onChange={(n) => setDraft({ ...draft, maxIterations: n })}
              format={(n) => `${n} ${n === 1 ? "draft" : "drafts"}`}
            />
            <div className="field-hint">Maximum planner revision rounds before selecting the best available calendar.</div>
          </div>

          <div className="field">
            <span className="meta-label">Model</span>
            <Dropdown
              value={draft.model}
              options={MODEL_OPTIONS}
              onChange={(m) => setDraft({ ...draft, model: m })}
              format={formatModel}
            />
            <div className="field-hint">OpenRouter model used to create schedules.</div>
            {isFreeModel(draft.model) && (
              <div className="warn">
                Free OpenRouter models are really, really slow and will probably timeout.
              </div>
            )}
          </div>

          <div className="field">
            <span className="meta-label">Evaluator (judge) model</span>
            <Dropdown
              value={draft.evaluatorModel ?? draft.model}
              options={BENCHMARK_MODEL_OPTIONS}
              onChange={(m) => setDraft({ ...draft, evaluatorModel: m })}
              format={formatModel}
            />
            <div className="field-hint">
              Fixed judge that scores schedules during benchmarks. Keep this the same across runs so model scores stay comparable.
            </div>
          </div>

          <div className="field">
            <label className="meta-label" htmlFor="settings-apikey">API Key</label>
            <input
              id="settings-apikey"
              className="text-input"
              type="password"
              value={draft.apiKey ?? ""}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-or-..."
              spellCheck={false}
            />
            <div className="field-hint">
              Your <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a> API key. Stored locally in the config file.
            </div>
          </div>
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={status === "saved"}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`btn-primary save-btn save-${status}`}
            disabled={status === "saved"}
          >
            {status === "saved" ? <Check size={14} /> : <Save size={14} />}
            <span>{status === "saved" ? "Saved" : "Save"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  variant,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={variant === "danger" ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            autoFocus
          >
            <Trash2 size={14} />
            <span>{confirmLabel}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
