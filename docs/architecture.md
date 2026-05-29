# Architecture

## Philosophy

Timebox is a **multi-agent negotiation system**, not a constraint-satisfaction solver.

The calendar emerges from disagreement and compromise between independent agents. There are **no hard constraints that block acceptance**. The only gatekeepers are:

1. **No critical critiques** — any agent can block the calendar with a `critical` issue.
2. **Quorum approvals** — by default all 5 agents must approve (or approve with minor concerns).

Validation runs for **logging and debugging only**. If the model schedules 12 hours on a day with 4 hours availability, that is logged as an issue but does not block acceptance. The Wellbeing Agent (or any other agent) should catch it in critique.

## System Flow

```
User Input
    ↓
Interpreter Agent  →  extracts tasks, deadlines, availability, student state
    ↓
5 Specialist Agents (parallel)  →  each gives independent perspective
    ↓
Planner-Arbiter  →  drafts calendar v1
    ↓
5 Specialist Agents critique calendar v1 (parallel)
    ↓
If no critical critiques AND quorum reached → ACCEPT
    ↓
Else Planner revises → v2, v3 ... up to max iterations
    ↓
If max iterations reached → choose best calendar by fewest critical/major issues
    ↓
Schedule Evaluator → score selected final calendar for model comparison
```

## Agents

| Agent | Role | Blocks acceptance with |
|-------|------|----------------------|
| Deadline Agent | Protects deadlines | Critical: task has no time before deadline |
| Grade Agent | Protects academic value | Critical: high-value work ignored |
| Effort Agent | Protects realistic estimates | Critical: completely implausible schedule |
| Wellbeing Agent | Protects sleep, stress, sustainability | Critical: schedule is inhumane |
| Risk Agent | Protects against hidden work | Critical: no buffers for uncertain tasks |

All agents run in parallel. Their views are preserved separately — we do **not** flatten them into a single score.

## Prompt Design

Prompts live in `src/main/prompts/*.md`. Each specialist has its own markdown file.

### Revision Prompt Compactness

The biggest source of JSON truncation is oversized revision prompts. We use **two different prompt builders**:

- **v1 (initial)** gets full context: student input, interpreter output, all specialist views.
- **v2+ (revision)** gets only what's necessary:
  - Ultra-compact previous calendar (day summaries as strings, not full block objects)
  - Only critical/major critiques
  - Task list (just id, name, deadline)
  - **No full agent views** (they don't change between iterations)
  - **No full interpreter output** (doesn't change)

This keeps revision prompts under ~15k chars instead of 46k+.

## Validation (Informational Only)

`src/main/validation.ts` checks structural issues and logs them:

- Day outside planning window
- Invalid block durations (end before start, negative hours)
- Work blocks referencing unknown or missing task_ids
- Blocks scheduled after task deadlines
- Tasks with deadlines inside the window but no scheduled blocks
- `buffer` / `break` blocks present (rest is implicit — unscheduled time IS rest)

Workload judgments (e.g. "this day has too many hours") are **not** validated structurally — that's the Wellbeing Agent's job.

These are **noted, not enforced**. The calendar can be accepted with violations if the agents approve it. This keeps the system flexible — if the user explicitly asks for an intense schedule, the agents can approve it even though validation flags it.

## Why No Hard Constraints?

Hard constraints create a brittle system:
- Models frequently violate them due to prompt misunderstanding or token pressure.
- A single violated constraint kills the entire run, even if the calendar is otherwise excellent.
- The agents are supposed to be the judges. If all 5 specialists approve a calendar, that is the correct output — even if a hard-coded rule disagrees.

The validation layer exists to help us **debug model behavior** and **improve prompts**, not to gate acceptance.

## Fallback Selection (Max Iterations)

If no version reaches acceptance after max iterations, we select the "best" version by:

1. Fewer critical issues
2. Fewer major issues
3. More approvals
4. Later version wins ties

Note: validation validity is **not** part of the fallback ranking.

## Schedule Evaluation (Diagnostic Only)

After the final calendar is selected, a separate **Schedule Evaluator** model scores the result. This is used to compare runs from different planner models, not to accept or reject the schedule.

The evaluator receives:

- original student input
- interpreter output
- specialist agent views
- selected final calendar
- final critiques
- validation log
- planner model and evaluator model names

It returns a qualitative model score:

- scores for requirement match, deadline safety, workload realism, academic priority, wellbeing balance, and risk resilience
- strengths, weaknesses, comparison notes, and a recommendation

The app also computes deterministic hard metrics:

- generation time in seconds
- final rejection count
- final critical issue count
- final major issue count
- deadline violation count
- task coverage ratio
- availability overrun hours, using each day's `assumed_available_hours`

The final displayed score is 50% qualitative model score and 50% hard-metric score. This keeps objective failures visible while still measuring schedule qualities that cannot be counted reliably.
