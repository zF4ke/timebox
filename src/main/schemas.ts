export const interpreterSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "current_date",
    "planning_window",
    "inferred_availability",
    "fixed_commitments",
    "student_state",
    "tasks",
    "assumptions"
  ],
  properties: {
    current_date: { type: "string" },
    planning_window: {
      type: "object",
      additionalProperties: false,
      required: ["start_date", "end_date", "reason"],
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
        reason: { type: "string" }
      }
    },
    inferred_availability: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date_range", "assumption", "estimated_available_hours_per_day", "confidence"],
        properties: {
          date_range: { type: "string" },
          assumption: { type: "string" },
          estimated_available_hours_per_day: { type: "number" },
          confidence: { type: "string" }
        }
      }
    },
    fixed_commitments: { type: "array", items: { type: "string" } },
    student_state: {
      type: "object",
      additionalProperties: false,
      required: ["sleep", "energy", "confidence"],
      properties: {
        sleep: { type: "string" },
        energy: { type: "string" },
        confidence: { type: "string" }
      }
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task_id", "name", "raw_mentions", "inferred_deadline", "uncertainties"],
        properties: {
          task_id: { type: "string" },
          name: { type: "string" },
          raw_mentions: { type: "array", items: { type: "string" } },
          inferred_deadline: { type: ["string", "null"] },
          uncertainties: { type: "array", items: { type: "string" } }
        }
      }
    },
    assumptions: { type: "array", items: { type: "string" } }
  }
};

export const specialistSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent", "task_views", "overall_comment"],
  properties: {
    agent: { type: "string", enum: ["Deadline Agent", "Grade Agent", "Effort Agent", "Wellbeing Agent", "Risk Agent"] },
    task_views: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "task_id",
          "task_name",
          "assessment",
          "concerns",
          "recommendations",
          "estimated_duration_hours",
          "confidence",
          "suggested_subtasks"
        ],
        properties: {
          task_id: { type: "string" },
          task_name: { type: "string" },
          assessment: { type: "string" },
          concerns: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
          estimated_duration_hours: { type: "number" },
          confidence: { type: "string" },
          suggested_subtasks: { type: "array", items: { type: "string" } }
        }
      }
    },
    overall_comment: { type: "string" }
  }
};

export const calendarSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "calendar_version",
    "planning_window",
    "overall_strategy",
    "days",
    "compromises",
    "known_weaknesses",
    "changes_from_previous",
    "unresolved_critiques"
  ],
  properties: {
    calendar_version: { type: "number" },
    planning_window: interpreterSchema.properties.planning_window,
    overall_strategy: { type: "array", items: { type: "string" } },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "day_name", "assumed_available_hours", "day_reasoning", "blocks"],
        properties: {
          date: { type: "string" },
          day_name: { type: "string" },
          assumed_available_hours: { type: "number" },
          day_reasoning: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "task_id",
                "task_name",
                "type",
                "start",
                "end",
                "duration_hours",
                "description",
                "reasoning"
              ],
              properties: {
                id: { type: "string" },
                task_id: { type: ["string", "null"] },
                task_name: { type: ["string", "null"] },
                type: { type: "string", enum: ["work", "buffer", "fixed", "break"] },
                start: { type: "string" },
                end: { type: "string" },
                duration_hours: { type: "number" },
                description: { type: "string" },
                reasoning: { type: "string" }
              }
            }
          }
        }
      }
    },
    compromises: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["conflict", "resolution"],
        properties: {
          conflict: { type: "string" },
          resolution: { type: "string" }
        }
      }
    },
    known_weaknesses: { type: "array", items: { type: "string" } },
    changes_from_previous: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["change", "reason"],
        properties: {
          change: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    unresolved_critiques: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "severity", "issue", "planner_response"],
        properties: {
          agent: { type: "string", enum: ["Deadline Agent", "Grade Agent", "Effort Agent", "Wellbeing Agent", "Risk Agent"] },
          severity: { type: "string", enum: ["none", "minor", "major", "critical"] },
          issue: { type: "string" },
          planner_response: { type: "string" }
        }
      }
    }
  }
};

export const critiqueSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "agent",
    "calendar_version",
    "approval",
    "severity",
    "critiques",
    "acknowledged_compromises",
    "overall_comment"
  ],
  properties: {
    agent: { type: "string", enum: ["Deadline Agent", "Grade Agent", "Effort Agent", "Wellbeing Agent", "Risk Agent"] },
    calendar_version: { type: "number" },
    approval: { type: "string", enum: ["approve", "approve_with_minor_concerns", "reject"] },
    severity: { type: "string", enum: ["none", "minor", "major", "critical"] },
    critiques: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue", "severity", "affected_tasks", "affected_days", "suggested_fix"],
        properties: {
          issue: { type: "string" },
          severity: { type: "string", enum: ["none", "minor", "major", "critical"] },
          affected_tasks: { type: "array", items: { type: "string" } },
          affected_days: { type: "array", items: { type: "string" } },
          suggested_fix: { type: "string" }
        }
      }
    },
    acknowledged_compromises: { type: "array", items: { type: "string" } },
    overall_comment: { type: "string" }
  }
};

export const scheduleEvaluationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "evaluator",
    "calendar_version",
    "planner_model",
    "evaluator_model",
    "overall_score",
    "dimension_scores",
    "strengths",
    "weaknesses",
    "comparison_notes",
    "recommendation"
  ],
  properties: {
    evaluator: { type: "string", enum: ["Schedule Evaluator"] },
    calendar_version: { type: "number" },
    planner_model: { type: "string" },
    evaluator_model: { type: "string" },
    overall_score: { type: "number", minimum: 1, maximum: 5 },
    dimension_scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "score", "rationale"],
        properties: {
          dimension: {
            type: "string",
            enum: [
              "requirement_match",
              "deadline_safety",
              "workload_realism",
              "academic_priority",
              "wellbeing_balance",
              "risk_resilience"
            ]
          },
          score: { type: "number", minimum: 1, maximum: 5 },
          rationale: { type: "string" }
        }
      }
    },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    comparison_notes: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" }
  }
};
