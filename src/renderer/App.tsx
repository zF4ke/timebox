import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput } from "@fullcalendar/core";
import type { PlannerDefaults, PlanningRequest, PlanningResult } from "../shared/types";

const SAMPLE_INPUT = `I have a DB lab due Tuesday night. It should be easy but I haven't started.
I have an AASMA proposal due Friday, worth 20%, and we still need to define the architecture.
I have an AI quiz on Thursday with two chapters to review.
I usually have classes in the morning and can work in the afternoon.
I slept badly yesterday.`;

const QUORUM_OPTIONS = [1, 2, 3, 4, 5];

export default function App() {
  const [userInput, setUserInput] = useState(SAMPLE_INPUT);
  const [quorum, setQuorum] = useState<number>(3);
  const [defaults, setDefaults] = useState<PlannerDefaults | null>(null);
  const [result, setResult] = useState<PlanningResult | null>(null);

  useEffect(() => {
    window.plannerApi.getDefaults().then((d) => {
      setDefaults(d);
      setQuorum(d.quorum);
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
    plannerMutation.mutate({ userInput, quorum });
  }

  function reset() {
    setResult(null);
    plannerMutation.reset();
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
            disabled={isRunning || !userInput.trim() || !defaults?.hasApiKey}
          >
            {isRunning ? "Planning..." : "Plan my week"}
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
