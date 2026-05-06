# Timebox

## Core idea

Timebox takes a natural-language description of a student’s tasks and generates a multi-day calendar plan.

The agents do **not** perform sequential subtasks. Instead, they represent different priorities and critique the same calendar from different perspectives.

```text
Deadline Agent → protects deadlines
Grade Agent → protects academic value
Effort Agent → protects realism of duration estimates
Wellbeing Agent → protects energy, sleep, and stress
Risk Agent → protects against hidden work and uncertainty
```

The final calendar emerges from negotiation.

---

# 1. Simple UI

The UI should stay minimal.

## User input

```text
Describe your tasks, deadlines, availability, and anything relevant.
```

Example:

```text
I have a DB lab due Tuesday night. It should be easy but I haven't started.
I have an AASMA proposal due Friday, worth 20%, and we still need to define the architecture.
I have an AI quiz on Thursday with two chapters to review.
I usually have classes in the morning and can work in the afternoon.
I slept badly yesterday.
```

## Quorum input

```text
Required approvals: [number]
```

Example:

```text
Required approvals: 3
```

If there are 5 specialist agents:

```text
3 = majority approval
5 = unanimous approval
```

That is much simpler than weighted voting.

---

# 2. System flow

```text
Computer current date/time
        ↓
User natural-language input + quorum number
        ↓
Interpreter Agent
        ↓
Specialist Agents
        ↓
Planner-Arbiter Agent creates calendar
        ↓
Specialist Agents critique calendar
        ↓
Stop condition check
        ↓
Revise or finalize
```

The system uses the computer’s current date to interpret phrases like:

```text
tomorrow
next Friday
this weekend
in 3 days
```

---

# 3. Interpreter Agent

The Interpreter Agent reads the user input and infers:

```text
tasks
deadlines
planning window
availability
fixed commitments
sleep/energy clues
uncertainties
```

The user does not need to manually fill all of these fields.

## Timeframe inference

Default rule:

```text
Planning starts today.
Planning ends on the latest inferred task deadline.
```

If there are no deadlines:

```text
Planning ends 7 days from today.
```

If the user explicitly says:

```text
plan only this week
plan until Wednesday
plan the next 3 days
```

then that overrides the default.

## Interpreter output example

```json
{
  "current_date": "2026-04-24",
  "planning_window": {
    "start_date": "2026-04-24",
    "end_date": "2026-05-01",
    "reason": "The latest inferred deadline is the AASMA proposal due Friday."
  },
  "inferred_availability": [
    {
      "date_range": "2026-04-24 to 2026-05-01",
      "assumption": "User said classes are usually in the morning, so work blocks should be placed mostly in the afternoon.",
      "estimated_available_hours_per_day": 4,
      "confidence": "medium"
    }
  ],
  "student_state": {
    "sleep": "bad yesterday",
    "energy": "reduced on first planning day",
    "confidence": "medium"
  },
  "tasks": [
    {
      "task_id": "T1",
      "name": "DB lab",
      "raw_mentions": [
        "due Tuesday night",
        "probably easy",
        "haven't started"
      ],
      "inferred_deadline": "2026-04-28 23:59",
      "uncertainties": [
        "exact duration not given"
      ]
    },
    {
      "task_id": "T2",
      "name": "AASMA proposal",
      "raw_mentions": [
        "due Friday",
        "worth 20%",
        "define the architecture"
      ],
      "inferred_deadline": "2026-05-01 23:59",
      "uncertainties": [
        "exact scope not fully specified",
        "presentation length not specified"
      ]
    }
  ]
}
```

---

# 4. Specialist agents

Each specialist agent receives:

```text
user input
current date
interpreter output
previous calendar version, if any
```

Each agent produces its own full interpretation.

The system should **not flatten** these views into one clean score.

Each task keeps all agent perspectives.

---

## Deadline Agent

Focuses on:

```text
urgency
deadline risk
latest safe start
tasks that cannot be delayed
```

Example:

```json
{
  "agent": "Deadline Agent",
  "task_views": [
    {
      "task_id": "T1",
      "urgency": "very high",
      "concerns": [
        "DB lab is due Tuesday night and has not been started."
      ],
      "recommendations": [
        "Schedule meaningful work before Tuesday.",
        "Avoid leaving all DB work for the deadline day."
      ]
    }
  ]
}
```

---

## Grade Agent

Focuses on:

```text
grade impact
academic value
whether a task deserves protected time
```

Example:

```json
{
  "agent": "Grade Agent",
  "task_views": [
    {
      "task_id": "T2",
      "grade_impact": "high",
      "concerns": [
        "AASMA proposal is worth 20%, so it should not be postponed completely."
      ],
      "recommendations": [
        "Reserve multiple blocks across the week.",
        "Include final polish time before submission."
      ]
    }
  ]
}
```

---

## Effort Agent

Focuses on:

```text
estimated duration
subtasks
whether work should be split
confidence in estimates
```

Example:

```json
{
  "agent": "Effort Agent",
  "task_views": [
    {
      "task_id": "T2",
      "estimated_duration_hours": 5,
      "confidence": "medium-low",
      "suggested_subtasks": [
        "choose final idea",
        "define architecture",
        "define orchestration process",
        "define evaluation metrics",
        "prepare presentation"
      ],
      "concerns": [
        "Open-ended project planning can take longer than expected."
      ]
    }
  ]
}
```

---

## Wellbeing Agent

Focuses on:

```text
stress
sleep
daily workload
breaks
cognitive load
sustainability
```

Example:

```json
{
  "agent": "Wellbeing Agent",
  "task_views": [
    {
      "task_id": "T2",
      "stress": "medium-high",
      "concerns": [
        "Architecture and evaluation design are cognitively demanding.",
        "The user slept badly, so the first day should be lighter."
      ],
      "recommendations": [
        "Use shorter blocks.",
        "Avoid stacking multiple high-stress tasks in one day."
      ]
    }
  ]
}
```

---

## Risk Agent

Focuses on:

```text
hidden work
uncertainty
underestimation
need for buffers
dependencies
```

Example:

```json
{
  "agent": "Risk Agent",
  "task_views": [
    {
      "task_id": "T2",
      "risk": "high",
      "risk_sources": [
        "architecture not defined",
        "evaluation not defined",
        "high grade impact"
      ],
      "recommendations": [
        "Start with an early exploration block.",
        "Keep a buffer block before the deadline."
      ]
    }
  ]
}
```

---

# 5. Agent-perspective memory

The system stores all interpretations.

Instead of this:

```json
{
  "task": "AASMA proposal",
  "stress": "high",
  "risk": "high",
  "duration": 5
}
```

use this:

```json
{
  "task_id": "T2",
  "task_name": "AASMA proposal",
  "interpreter_view": {
    "deadline": "2026-05-01",
    "raw_mentions": [
      "due Friday",
      "worth 20%",
      "define the architecture"
    ],
    "uncertainties": [
      "exact duration not given",
      "scope not fully specified"
    ]
  },
  "agent_views": {
    "deadline_agent": {
      "urgency": "medium-high",
      "concerns": [
        "Friday is not immediate, but the task has several components."
      ],
      "recommendations": [
        "Begin before the final two days."
      ]
    },
    "grade_agent": {
      "grade_impact": "high",
      "concerns": [
        "Worth 20%, so it deserves protected time."
      ],
      "recommendations": [
        "Schedule across multiple days."
      ]
    },
    "effort_agent": {
      "estimated_duration_hours": 5,
      "confidence": "medium-low",
      "suggested_subtasks": [
        "choose idea",
        "define architecture",
        "define evaluation",
        "prepare presentation"
      ]
    },
    "wellbeing_agent": {
      "stress": "medium-high",
      "concerns": [
        "Avoid placing this after another high cognitive-load block."
      ]
    },
    "risk_agent": {
      "risk": "high",
      "concerns": [
        "Architecture and evaluation are still uncertain."
      ],
      "recommendations": [
        "Start early and keep a buffer."
      ]
    }
  }
}
```

This preserves disagreement and detail.

---

# 6. Planner-Arbiter Agent

The Planner-Arbiter receives:

```text
user input
interpreter output
all specialist agent views
previous critiques, if any
quorum requirement
```

It produces a full calendar.

Important: the planner must include its reasoning **inside the plan**, so agents can understand the compromises during critique.

The plan should not just say:

```text
Monday: DB lab, 2h
```

It should say:

```text
Monday: DB lab, 2h
Reason: scheduled early because the Deadline Agent flagged the Tuesday deadline, but limited to 2h because the Wellbeing Agent warned about poor sleep today.
```

That lets agents critique the actual compromise, not just the raw schedule.

---

# 7. Calendar proposal format

Example:

```json
{
  "calendar_version": 1,
  "planning_window": {
    "start_date": "2026-04-24",
    "end_date": "2026-05-01"
  },
  "overall_strategy": [
    "Prioritize DB lab before Tuesday because it is the earliest deadline.",
    "Start AASMA early because Grade and Risk Agents flagged it as high-impact and uncertain.",
    "Distribute AI quiz study before Thursday instead of cramming.",
    "Keep the first day lighter because the Wellbeing Agent flagged poor sleep."
  ],
  "days": [
    {
      "date": "2026-04-24",
      "day_name": "Friday",
      "assumed_available_hours": 3,
      "day_reasoning": "Reduced workload because the user slept badly yesterday.",
      "blocks": [
        {
          "task_id": "T1",
          "task_name": "DB lab",
          "duration_hours": 1.5,
          "description": "Start lab and identify blockers.",
          "reasoning": "The Deadline Agent rated this as urgent. The Effort Agent warned that 'easy but not started' still needs an initial discovery block."
        },
        {
          "task_id": "T2",
          "task_name": "AASMA proposal",
          "duration_hours": 1,
          "description": "Clarify architecture options.",
          "reasoning": "The Grade Agent and Risk Agent both recommended starting early because the task is high-impact and open-ended."
        },
        {
          "type": "buffer",
          "duration_hours": 0.5,
          "description": "Break/recovery buffer.",
          "reasoning": "Included because the Wellbeing Agent flagged reduced energy."
        }
      ]
    }
  ],
  "compromises": [
    {
      "conflict": "Deadline Agent wanted more DB lab time immediately, while Wellbeing Agent wanted a lighter first day.",
      "resolution": "Scheduled a shorter DB lab discovery block today, with more DB time on the next available day."
    },
    {
      "conflict": "Grade Agent wanted protected AASMA time, while Deadline Agent prioritized DB lab.",
      "resolution": "AASMA receives a smaller early block today and larger blocks after the DB lab deadline is controlled."
    }
  ],
  "known_weaknesses": [
    "The DB lab duration is uncertain.",
    "The plan assumes afternoon availability because the user mentioned morning classes."
  ]
}
```

This is exactly what you want: the plan contains compromise reasoning.

---

# 8. Agent critique round

Each specialist agent reviews the calendar and its reasoning.

The agent can now say:

```text
I understand why the Planner gave only 1.5h to DB lab today, but I still consider this insufficient before the Tuesday deadline.
```

Or:

```text
The Planner addressed my wellbeing concern by adding a buffer on Friday, so I approve.
```

This makes the critique process much more coherent.

---

# 9. Critique format

Each agent returns:

```json
{
  "agent": "Deadline Agent",
  "calendar_version": 1,
  "approval": "reject",
  "severity": "critical",
  "critiques": [
    {
      "issue": "DB lab has insufficient time before Tuesday night.",
      "severity": "critical",
      "affected_tasks": ["T1"],
      "affected_days": ["2026-04-24", "2026-04-25"],
      "suggested_fix": "Add at least 2 more hours of DB lab before Tuesday."
    }
  ],
  "acknowledged_compromises": [
    "The planner reduced Friday workload due to the Wellbeing Agent's concern."
  ],
  "overall_comment": "The compromise is understandable, but the deadline risk remains too high."
}
```

Approval values:

```text
approve
approve_with_minor_concerns
reject
```

Severity values:

```text
none
minor
major
critical
```

---

# 10. Stop condition

Use only quorum, critique severity, hard constraints, and max iterations.

No weighted mode.

Let:

```text
N = number of specialist agents
Q = required quorum input by user
```

Example:

```text
N = 5
Q = 3
```

A calendar is accepted if:

```text
1. hard constraint checker passes;
2. no agent has a critical critique;
3. number of approving agents >= Q.
```

Where approving agents are:

```text
approve
approve_with_minor_concerns
```

So:

```text
approve = counts toward quorum
approve_with_minor_concerns = counts toward quorum
reject = does not count
```

---

# 11. Revision condition

The planner must revise if:

```text
hard constraints fail
OR any critical critique exists
OR approvals < quorum
```

Major critiques do not automatically block acceptance unless the agent rejects and quorum fails.

However, major critiques must be addressed or explicitly justified.

Rule:

```text
If a major critique remains in the accepted plan, the Planner must explain why it was not fully resolved.
```

This is clean.

---

# 12. Max iterations

Use:

```text
max_iterations = 3
```

Each iteration:

```text
Planner proposes/revises calendar
Specialist agents critique
Constraint checker validates
Stop condition checks acceptance
```

Pseudo-flow:

```python
max_iterations = 3

interpreter_output = interpreter(user_input, current_datetime)
agent_views = run_specialist_agents(user_input, interpreter_output)

calendar_versions = []

calendar = planner_create_calendar(
    user_input=user_input,
    interpreter_output=interpreter_output,
    agent_views=agent_views,
    quorum=Q
)

for iteration in range(max_iterations):
    critiques = run_critiques(
        calendar=calendar,
        agent_views=agent_views
    )

    validation = constraint_check(
        calendar=calendar,
        interpreter_output=interpreter_output
    )

    calendar_versions.append({
        "calendar": calendar,
        "critiques": critiques,
        "validation": validation
    })

    approvals = count_approvals(critiques)
    has_critical = any_critical(critiques)

    if validation.valid and not has_critical and approvals >= Q:
        final_calendar = calendar
        stop_reason = "Accepted by quorum with no critical critiques."
        break

    calendar = planner_revise_calendar(
        previous_calendar=calendar,
        critiques=critiques,
        validation=validation,
        agent_views=agent_views,
        quorum=Q
    )

else:
    final_calendar = choose_best_calendar(calendar_versions)
    stop_reason = "Maximum iterations reached. Selected best available calendar."
```

---

# 13. Choosing best calendar after max iterations

If no version reaches acceptance, choose the best one using a simple fallback:

```text
1. Valid calendar beats invalid calendar.
2. Fewer critical critiques is better.
3. Fewer major critiques is better.
4. More approvals is better.
5. Later version wins ties.
```

Example:

```text
Version 1:
- valid: yes
- critical critiques: 1
- major critiques: 2
- approvals: 2

Version 2:
- valid: yes
- critical critiques: 0
- major critiques: 2
- approvals: 2

Version 3:
- valid: yes
- critical critiques: 0
- major critiques: 1
- approvals: 3

Selected: Version 3
```

This fallback is not the main decision process. It only prevents infinite loops.

---

# 14. Constraint checker

The constraint checker should be simple code.

It checks hard constraints only.

Examples:

```text
calendar dates are inside planning window
no day exceeds inferred available hours
no task block is scheduled after that task's deadline
durations are positive
calendar has at least one block before each required deadline task
```

Optional hard constraint:

```text
if a task is due within the planning window, it must receive some scheduled time before its deadline
```

The constraint checker should not decide whether the plan is “good.”
It only decides whether the plan is structurally valid.

---

# 15. Planner revision instructions

When revising, the Planner receives:

```text
previous calendar
all critiques
constraint violations
agent views
quorum requirement
```

It should follow this priority order:

```text
1. Fix hard constraint violations.
2. Fix critical critiques.
3. Increase approvals until quorum is reached.
4. Address major critiques where possible.
5. Preserve approved parts of the calendar.
6. Explain all compromises.
```

The revised calendar should include:

```text
what changed
why it changed
which critiques were addressed
which critiques remain
why any remaining major critique was accepted
```

Example:

```json
{
  "calendar_version": 2,
  "changes_from_previous": [
    {
      "change": "Added 2 hours of DB lab on Saturday.",
      "reason": "Deadline Agent issued a critical critique that DB lab had insufficient time before Tuesday."
    },
    {
      "change": "Moved AI quiz review from Saturday to Sunday.",
      "reason": "Preserved total workload while making room for DB lab."
    }
  ],
  "unresolved_critiques": [
    {
      "agent": "Wellbeing Agent",
      "severity": "major",
      "issue": "Monday remains somewhat heavy.",
      "planner_response": "Accepted because DB lab deadline is close, but included a buffer block and avoided late-night work."
    }
  ]
}
```

---

# 16. Final user output

The final output should be simple and calendar-like.

Example:

```text
Planning window: Friday, Apr 24 → Friday, May 1  
Stop reason: Accepted by 4/5 agents with no critical critiques.

Assumptions:
- “Friday” was interpreted as May 1.
- You mentioned morning classes, so work was placed mostly in afternoon-style blocks.
- You slept badly yesterday, so the first day is lighter.

Calendar

Friday, Apr 24 — 3h planned
- 1.5h DB lab: start and identify blockers.
- 1h AASMA proposal: clarify architecture options.
- 0.5h buffer/recovery.

Saturday, Apr 25 — 4h planned
- 2h DB lab: main implementation.
- 1.5h AASMA proposal: define agents and orchestration.
- 0.5h AI quiz: light review.

Sunday, Apr 26 — 4h planned
- 1h DB lab: testing/polish.
- 2h AI quiz: chapter 1 and practice.
- 1h AASMA proposal: evaluation metrics.

...

Main compromises:
- DB lab was prioritized early because it is due first.
- AASMA still receives early protected time because it is high-impact and risky.
- The first day is lighter because of poor sleep.

Agent results:
- Deadline Agent: approve
- Grade Agent: approve
- Effort Agent: approve with minor concerns
- Wellbeing Agent: approve with minor concerns
- Risk Agent: approve

Remaining concerns:
- DB lab duration is uncertain because the user said it is easy but has not started.
```

The user sees the useful thing first: the calendar.

---

# 17. Final project summary

A concise project description:

> We propose Timebox, a multi-agent calendar planner for students. The system receives a natural-language description of tasks, deadlines, availability, sleep, and constraints. An Interpreter Agent infers the planning window and task information using the computer’s current date. Specialist agents independently interpret each task from different perspectives: deadlines, grade impact, effort, wellbeing, and risk. A Planner-Arbiter creates a multi-day calendar and includes the reasoning behind its compromises. The specialist agents critique the calendar, assigning approval and critique severity. The system revises until a user-defined quorum approves the plan with no critical critiques, or until a maximum number of iterations is reached.

That is clean, controlled, and clearly multi-agent.
