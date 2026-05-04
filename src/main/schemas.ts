export const interpreterSchema = {
  type: "object",
  properties: {
    current_date: { type: "string" },
    planning_window: {
      type: "object",
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
        properties: {
          task_id: { type: "string" },
          name: { type: "string" },
          raw_mentions: { type: "array", items: { type: "string" } },
          inferred_deadline: { type: "string" },
          uncertainties: { type: "array", items: { type: "string" } }
        }
      }
    },
    assumptions: { type: "array", items: { type: "string" } }
  }
};

export const specialistSchema = {
  type: "object",
  properties: {
    agent: { type: "string" },
    task_views: {
      type: "array",
      items: {
        type: "object",
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
  properties: {
    calendar_version: { type: "number" },
    planning_window: interpreterSchema.properties.planning_window,
    overall_strategy: { type: "array", items: { type: "string" } },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          day_name: { type: "string" },
          assumed_available_hours: { type: "number" },
          day_reasoning: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                task_id: { type: "string" },
                task_name: { type: "string" },
                type: { type: "string" },
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
        properties: {
          agent: { type: "string" },
          severity: { type: "string" },
          issue: { type: "string" },
          planner_response: { type: "string" }
        }
      }
    }
  }
};

export const critiqueBundleSchema = {
  type: "object",
  properties: {
    critiques: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agent: { type: "string" },
          calendar_version: { type: "number" },
          approval: { type: "string" },
          severity: { type: "string" },
          critiques: {
            type: "array",
            items: {
              type: "object",
              properties: {
                issue: { type: "string" },
                severity: { type: "string" },
                affected_tasks: { type: "array", items: { type: "string" } },
                affected_days: { type: "array", items: { type: "string" } },
                suggested_fix: { type: "string" }
              }
            }
          },
          acknowledged_compromises: { type: "array", items: { type: "string" } },
          overall_comment: { type: "string" }
        }
      }
    }
  }
};
