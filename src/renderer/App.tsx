import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import type {
  PlannerDefaults,
  PlanningRequest,
  PlanningResult,
  ProgressEvent
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
  const [quorum, setQuorum] = useState<number>(3);
  const [defaults, setDefaults] = useState<PlannerDefaults | null>(null);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [steps, setSteps] = useState<StepItem[]>([]);

  useEffect(() => {
    window.plannerApi.getDefaults().then((d) => {
      setDefaults(d);
      setQuorum(d.quorum);
    });
  }, []);

  useEffect(() => {
    return window.plannerApi.onProgress((ev) => {
      setSteps((prev) => applyProgress(prev, ev));
    });
  }, []);

  const plannerMutation = useMutation({
    mutationFn: (request: PlanningRequest) => window.plannerApi.runPlanner(request),
    onSuccess: setResult
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
        extendedProps: { description: block.description }
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

  function reset() {
    setResult(null);
    setSteps([]);
    plannerMutation.reset();
  }

  if (isRunning || (steps.length > 0 && !result && error === "")) {
    return <RunningView steps={steps} />;
  }

  if (result) {
    return (
      <ResultView
        result={result}
        events={events}
        initialDate={initialDate}
        onReset={reset}
      />
    );
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
            onClick={runPlanner}
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

function RunningView({ steps }: { steps: StepItem[] }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps]);

  const errorStep = steps.find((s) => s.status === "error");

  return (
    <main className="shell">
      <div className="composer running">
        <h1>{errorStep ? "Something went wrong" : "Planning your week"}</h1>
        <p className="subtitle">
          {errorStep ? errorStep.summary : "Agents are reasoning. Check the terminal for full logs."}
        </p>

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
        {step.status === "done" && <CheckIcon />}
        {step.status === "pending" && <span className="dot-pending" />}
        {step.status === "error" && <span className="x-icon">×</span>}
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3 8.5l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
      return `Critique round${ev.iteration ? ` v${ev.iteration}` : ""}`;
    case "validate":
      return `Constraint check${ev.iteration ? ` v${ev.iteration}` : ""}`;
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
  onReset
}: {
  result: PlanningResult;
  events: EventInput[];
  initialDate: string;
  onReset: () => void;
}) {
  const approvals = result.critiques.filter(
    (c) => c.approval === "approve" || c.approval === "approve_with_minor_concerns"
  ).length;

  return (
    <main className="result-shell">
      <header className="result-header">
        <div>
          <h2>Plan</h2>
          <p>
            {result.finalCalendar.planning_window.start_date} → {result.finalCalendar.planning_window.end_date}
            <span className="dot">·</span>
            {approvals}/5 approvals
            <span className="dot">·</span>
            {result.validation.valid ? "valid" : "needs review"}
          </p>
        </div>
        <div className="actions">
          <button
            className="ghost"
            onClick={() => downloadFile("plan.json", result.exports.json, "application/json")}
          >
            JSON
          </button>
          <button
            className="ghost"
            onClick={() => downloadFile("plan.ics", result.exports.ics, "text/calendar")}
          >
            ICS
          </button>
          <button className="ghost" onClick={onReset}>New</button>
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
          eventContent={(arg) => (
            <div className="ev">
              <strong>{arg.event.title}</strong>
              <span>{arg.event.extendedProps.description as string}</span>
            </div>
          )}
        />
      </section>
    </main>
  );
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
