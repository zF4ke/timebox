import type { CalendarProposal, ConstraintValidation, InterpreterOutput } from "../shared/types";

export function validateCalendar(calendar: CalendarProposal, interpreterOutput: InterpreterOutput): ConstraintValidation {
  const violations: ConstraintValidation["violations"] = [];
  const startWindow = parseDate(calendar.planning_window.start_date);
  const endWindow = parseEndWindow(calendar.planning_window.end_date);
  const taskIds = new Set(interpreterOutput.tasks.map((t) => t.task_id));
  const taskDeadlines = new Map<string, Date>();
  for (const task of interpreterOutput.tasks) {
    if (!task.inferred_deadline) {
      continue;
    }
    const deadline = parseDate(task.inferred_deadline);
    if (deadline) {
      taskDeadlines.set(task.task_id, deadline);
    }
  }
  const blocksByTask = new Map<string, number>();

  if (!startWindow || !endWindow) {
    violations.push({
      code: "invalid_planning_window",
      message: "Planning window dates are invalid.",
      severity: "error"
    });
  }

  for (const day of calendar.days) {
    const dayDate = parseDate(day.date);
    if (!dayDate || (startWindow && dayDate < stripTime(startWindow)) || (endWindow && dayDate > stripTime(endWindow))) {
      violations.push({
        code: "day_outside_window",
        message: `${day.date} is outside the planning window ${calendar.planning_window.start_date} → ${calendar.planning_window.end_date}.`,
        severity: "error"
      });
    }

    const dailyHours = day.blocks.reduce((sum, block) => sum + Number(block.duration_hours || 0), 0);
    if (dailyHours > day.assumed_available_hours + 0.01) {
      violations.push({
        code: "daily_availability_exceeded",
        message: `${day.date} schedules ${dailyHours.toFixed(1)}h total, above the stated ${day.assumed_available_hours.toFixed(1)}h available. Reduce blocks or increase assumed_available_hours.`,
        severity: "error"
      });
    }

    for (const block of day.blocks) {
      const blockStart = parseDate(block.start);
      const blockEnd = parseDate(block.end);
      if (!blockStart || !blockEnd || blockEnd <= blockStart || block.duration_hours <= 0) {
        violations.push({
          code: "invalid_block_duration",
          message: `${block.description || block.id} has an invalid time range or non-positive duration (${block.duration_hours}h).`,
          severity: "error"
        });
      }

      if (startWindow && blockStart && blockStart < startWindow) {
        violations.push({
          code: "block_before_window",
          message: `${block.description || block.id} starts before the planning window.`,
          severity: "error"
        });
      }

      if (endWindow && blockEnd && blockEnd > endWindow) {
        violations.push({
          code: "block_after_window",
          message: `${block.description || block.id} ends after the planning window.`,
          severity: "error"
        });
      }

      if (block.type === "buffer" || block.type === "break") {
        violations.push({
          code: "rest_block_not_allowed",
          message: `Block "${block.description || block.id}" is a ${block.type} block. Rest/buffer blocks are not allowed — unscheduled time is implicitly rest.`,
          severity: "error"
        });
      }

      if (block.type === "work") {
        if (!block.task_id) {
          violations.push({
            code: "work_block_missing_task",
            message: `Work block "${block.description || block.id}" must have a task_id.`,
            severity: "error"
          });
        } else if (!taskIds.has(block.task_id)) {
          violations.push({
            code: "unknown_task_id",
            message: `Block references unknown task_id "${block.task_id}". Valid tasks: ${Array.from(taskIds).join(", ")}.`,
            severity: "error"
          });
        }
      }

      if (block.task_id) {
        blocksByTask.set(block.task_id, (blocksByTask.get(block.task_id) ?? 0) + 1);
        const deadline = taskDeadlines.get(block.task_id);
        if (deadline && blockEnd && blockEnd > deadline) {
          violations.push({
            code: "block_after_deadline",
            message: `${block.task_name ?? block.task_id} has work scheduled after its deadline (${deadline.toISOString()}).`,
            severity: "error"
          });
        }
      }
    }
  }

  for (const [taskId, deadline] of taskDeadlines) {
    if (startWindow && endWindow && deadline >= startWindow && deadline <= endWindow && !blocksByTask.has(taskId)) {
      violations.push({
        code: "deadline_task_unscheduled",
        message: `${taskId} has a deadline inside the planning window but no scheduled work block.`,
        severity: "error"
      });
    }
  }

  if (violations.length > 0) {
    console.log(`[validate] ${violations.length} violation(s):`);
    for (const v of violations) {
      console.log(`[validate]  - ${v.code}: ${v.message}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEndWindow(value: string): Date | null {
  const date = parseDate(value);
  if (!date) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? endOfDay(date) : date;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function stripTime(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
