import { useEffect, useMemo, useRef, useState } from "react";
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
  X
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
  const [quorum, setQuorum] = useState<number>(5);
  const [defaults, setDefaults] = useState<PlannerDefaults | null>(null);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [steps, setSteps] = useState<StepItem[]>([]);
  const [saved, setSaved] = useState<SavedCalendar[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    window.plannerApi.getDefaults().then((d) => {
      setDefaults(d);
      setQuorum(d.quorum);
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

  const events = useMemo<EventInput[]>(() => {
    if (!result) return [];
    return result.finalCalendar.days.flatMap((day) =>
      day.blocks.map((block) => ({
        id: block.id,
        title: block.task_name ?? block.description,
        start: block.start,
        end: block.end,
        classNames: [`event-${block.type ?? "work"}`],
        extendedProps: { block }
      }))
    );
  }, [result]);

  const isRunning = plannerMutation.isPending;
  const error = plannerMutation.error instanceof Error ? plannerMutation.error.message : "";
  const initialDate = result?.finalCalendar.planning_window.start_date ?? new Date().toISOString().slice(0, 10);

  function runPlanner() {
    setResult(null);
    setSteps([]);
    plannerMutation.mutate({ userInput, quorum });
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

  async function handleDelete(id: string) {
    await window.plannerApi.deleteCalendar(id);
    refreshSaved();
  }

  async function handleSave() {
    if (!result) return;
    const defaultName = `Plan · ${new Date().toLocaleString()}`;
    const name = window.prompt("Name this plan", defaultName);
    if (name === null) return;
    await window.plannerApi.saveCalendar(name, result);
    refreshSaved();
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
      />
    );
  } else {
    content = (
      <ComposerView
        userInput={userInput}
        setUserInput={setUserInput}
        quorum={quorum}
        setQuorum={setQuorum}
        defaults={defaults}
        error={error}
        onRun={runPlanner}
      />
    );
  }

  return (
    <AppLayout
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      saved={saved}
      onImport={handleImport}
      onLoad={handleLoad}
      onDelete={handleDelete}
    >
      {content}
    </AppLayout>
  );
}

function AppLayout({
  children,
  sidebarOpen,
  setSidebarOpen,
  saved,
  onImport,
  onLoad,
  onDelete
}: {
  children: React.ReactNode;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  saved: SavedCalendar[];
  onImport: () => void;
  onLoad: (c: SavedCalendar) => void;
  onDelete: (id: string) => void;
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
                onClick={() => onDelete(cal.id)}
                title="Delete"
                aria-label="Delete plan"
              >
                <X size={14} />
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
        {children}
      </div>
    </div>
  );
}

function ComposerView({
  userInput,
  setUserInput,
  quorum,
  setQuorum,
  defaults,
  error,
  onRun
}: {
  userInput: string;
  setUserInput: (v: string) => void;
  quorum: number;
  setQuorum: (n: number) => void;
  defaults: PlannerDefaults | null;
  error: string;
  onRun: () => void;
}) {
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

        <div className="row">
          <label className="quorum">
            <span>Approvals required</span>
            <select value={quorum} onChange={(e) => setQuorum(Number(e.target.value))}>
              {QUORUM_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} of 5</option>
              ))}
            </select>
          </label>

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
            <span>{defaults.model}</span>
            <span>·</span>
            <span>{defaults.timezone}</span>
          </div>
        )}
      </div>
    </main>
  );
}

function RunningView({ steps, onCancel }: { steps: StepItem[]; onCancel: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps]);

  const errorStep = steps.find((s) => s.status === "error");

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

        <div className="steps" ref={listRef}>
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </div>
      </div>
    </main>
  );
}

function StepRow({ step }: { step: StepItem }) {
  const elapsed =
    step.startedAt && step.endedAt ? `${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s` : "";

  return (
    <div className={`step step-${step.status}`}>
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
  onSave
}: {
  result: PlanningResult;
  events: EventInput[];
  initialDate: string;
  onReset: () => void;
  onSave: () => void;
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
          <button className="btn-secondary" onClick={onSave} title="Save this plan">
            <Save size={14} />
            <span>Save</span>
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
                {block?.description && <span>{block.description}</span>}
              </div>
            );
          }}
        />
      </section>

      {activeBlock && (
        <BlockModal block={activeBlock} onClose={() => setActiveBlock(null)} />
      )}
    </main>
  );
}

function BlockModal({ block, onClose }: { block: CalendarBlock; onClose: () => void }) {
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
            <h3>{block.task_name ?? block.description}</h3>
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
            <p>{block.description}</p>
          </div>
          {block.reasoning && (
            <div className="modal-section">
              <div className="meta-label">Reasoning</div>
              <p>{block.reasoning}</p>
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

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
