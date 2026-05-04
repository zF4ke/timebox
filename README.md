# Multi-Agent Student Calendar Planner

Electron prototype for the AASMA multi-agent calendar planner.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
PLANNER_TIMEZONE=Europe/Lisbon
PLANNER_QUORUM=3
PLANNER_MAX_ITERATIONS=3
PLANNER_DAILY_HOURS=4
```

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

## Behavior

- Interpreter Agent infers tasks, deadlines, availability, planning window, student state, assumptions.
- Deadline, Grade, Effort, Wellbeing, Risk agents produce separate task views.
- Planner-Arbiter creates and revises calendar versions.
- Specialist agents critique each calendar.
- Deterministic code checks hard constraints.
- Stop condition: valid calendar, no critical critique, approvals ≥ quorum.
- JSON export = full audit trail. ICS export = importable calendar events.
