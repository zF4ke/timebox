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
  Settings
} from "lucide-react";
import type {
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
const SETTINGS_KEY = "planner:settings";

interface UserSettings {
  quorum: number;
  model: string; // empty string means "use env default"
}

function loadSettings(): UserSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      quorum: typeof parsed.quorum === "number" ? parsed.quorum : 5,
      model: typeof parsed.model === "string" ? parsed.model : ""
    };
  } catch {
    return null;
  }
}

function persistSettings(s: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
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
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings() ?? { quorum: 5, model: "" });
  const [defaults, setDefaults] = useState<PlannerDefaults | null>(null);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [saved, setSaved] = useState<SavedCalendar[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [pendingDelete, setPendingDelete] = useState<SavedCalendar | null>(null);

  useEffect(() => {
    window.plannerApi.getDefaults().then((d) => {
      setDefaults(d);
      // First-time init: if no stored settings, fall back to env defaults
      if (!loadSettings()) {
        setSettings({ quorum: d.quorum, model: "" });
      }
    });
    refreshSaved();
  }, []);

  useEffect(() => {
    return window.plannerApi.onProgress((ev) => {
      setSteps((prev) => applyProgress(prev, ev));
    });
  }, []);

  function refreshSaved() {
    window.plannerApi.listCalendars().then(setSaved);
  }

  const plannerMutation = useMutation({
    mutationFn: (request: PlanningRequest) => window.plannerApi.runPlanner(request),
    onSuccess: (res) => {
      setResult(res);
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

  const isRunning = plannerMutation.isPending;
  const error = plannerMutation.error instanceof Error ? plannerMutation.error.message : "";
  const initialDate = result?.finalCalendar.planning_window.start_date ?? new Date().toISOString().slice(0, 10);

  function runPlanner() {
    setResult(null);
    setSteps([]);
    const request: PlanningRequest = { userInput, quorum: settings.quorum };
    if (settings.model.trim()) request.model = settings.model.trim();
    plannerMutation.mutate(request);
  }

  function handleSettingsChange(next: UserSettings) {
    setSettings(next);
    persistSettings(next);
  }

  async function cancelPlanner() {
    await window.plannerApi.cancelPlanner();
  }

  function reset() {
    setResult(null);
    setSteps([]);
    plannerMutation.reset();
  }

  async function handleImport() {
    const imported = await window.plannerApi.importFile();
    if (imported) {
      setResult(imported);
      refreshSaved();
    }
  }

  async function handleLoad(savedCal: SavedCalendar) {
    const loaded = await window.plannerApi.loadCalendar(savedCal.id);
    if (loaded) {
      setResult(loaded.result);
      setSteps([]);
      plannerMutation.reset();
      setSidebarOpen(false);
    }
  }

  function handleRequestDelete(cal: SavedCalendar) {
    setPendingDelete(cal);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    await window.plannerApi.deleteCalendar(pendingDelete.id);
    setPendingDelete(null);
    refreshSaved();
  }

  function handleSave() {
    if (!result) return;
    setSaveStatus("idle");
    setSavePromptOpen(true);
  }

  async function handleConfirmSave(name: string) {
    if (!result) return;
    setSaveStatus("saving");
    await window.plannerApi.saveCalendar(name, result);
    setSaveStatus("saved");
    refreshSaved();
    setTimeout(() => {
      setSavePromptOpen(false);
      setSaveStatus("idle");
    }, 700);
  }

  let content: React.ReactNode;
  if (isRunning || (steps.length > 0 && !result && error === "")) {
    content = <RunningView steps={steps} onCancel={cancelPlanner} />;
  } else if (result) {
    content = (
      <ResultView
        result={result}
        events={events}
        initialDate={initialDate}
        onReset={reset}
        onSave={handleSave}
        saveStatus={saveStatus}
        taskNameMap={taskNameMap}
      />
    );
  } else {
    content = (
      <ComposerView
        userInput={userInput}
        setUserInput={setUserInput}
        defaults={defaults}
        settings={settings}
        error={error}
        onRun={runPlanner}
      />
    );
  }

  return (
    <>
      <AppLayout
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        saved={saved}
        onImport={handleImport}
        onLoad={handleLoad}
        onDelete={handleRequestDelete}
        onOpenSettings={() => setSettingsOpen(true)}
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
  onOpenSettings
}: {
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  saved: SavedCalendar[];
  onImport: () => void;
  onLoad: (c: SavedCalendar) => void;
  onDelete: (c: SavedCalendar) => void;
  onOpenSettings: () => void;
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
                {cal.name}
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
        <button
          className="floating-toggle floating-toggle-right"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

function ComposerView({
  userInput,
  setUserInput,
  defaults,
  settings,
  error,
  onRun
}: {
  userInput: string;
  setUserInput: (v: string) => void;
  defaults: PlannerDefaults | null;
  settings: UserSettings;
  error: string;
  onRun: () => void;
}) {
  const activeModel = settings.model.trim() || defaults?.model || "";

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
        />

        <div className="row row-end">
          <button
            className="run"
            onClick={onRun}
            disabled={!userInput.trim() || !defaults?.hasApiKey}
          >
            Plan my week
          </button>
        </div>

        {defaults && !defaults.hasApiKey && (
          <div className="warn">Set <code>OPENROUTER_API_KEY</code> in <code>.env</code> to run the planner.</div>
        )}

        {error && <div className="err">{error}</div>}

        {defaults && (
          <div className="meta">
            <span>{activeModel}</span>
            <span>·</span>
            <span>{settings.quorum}/5 approvals</span>
          </div>
        )}
      </div>
    </main>
  );
}

function RunningView({ steps, onCancel }: { steps: StepItem[]; onCancel: () => void }) {
  const errorStep = steps.find((s) => s.status === "error");
  const reversed = useMemo(() => [...steps].reverse(), [steps]);

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
            <button className="cancel-btn" onClick={onCancel}>
              Cancel run
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
  taskNameMap
}: {
  result: PlanningResult;
  events: EventInput[];
  initialDate: string;
  onReset: () => void;
  onSave: () => void;
  saveStatus: "idle" | "saving" | "saved";
  taskNameMap: Record<string, string>;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState<CalendarBlock | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen]);

  const approvals = result.critiques.filter(
    (c) => c.approval === "approve" || c.approval === "approve_with_minor_concerns"
  ).length;

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
            <span className="dot">·</span>
            {approvals}/5 approvals
            <span className="dot">·</span>
            {result.validation.valid ? "clean" : `${result.validation.violations.length} issue(s) logged`}
          </p>
        </div>
        <div className="actions">
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
  format?: (v: T) => string;
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
        <span>{label(value)}</span>
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
                  <span>{label(opt)}</span>
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
  settings: UserSettings;
  defaults: PlannerDefaults | null;
  onChange: (s: UserSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<UserSettings>(settings);
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

  const envModel = defaults?.model ?? "";

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
            <label className="meta-label" htmlFor="settings-model">Model</label>
            <input
              id="settings-model"
              className="text-input"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder={envModel || "openai/gpt-4o-mini"}
              spellCheck={false}
            />
            <div className="field-hint">
              OpenRouter model id. Leave empty to use the env default
              {envModel && <> (<code>{envModel}</code>)</>}.
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
