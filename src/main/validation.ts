import type { CalendarProposal, ConstraintValidation, InterpreterOutput } from "../shared/types";

export function validateCalendar(calendar: CalendarProposal, interpreterOutput: InterpreterOutput): ConstraintValidation {
  const violations: ConstraintValidation["violations"] = [];
  const startWindow = parseDate(calendar.planning_window.start_date);
  const endWindow = parseEndWindow(calendar.planning_window.end_date);
  const availability = new Map(calendar.days.map((day) => [day.date, day.assumed_available_hours]));
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
        message: `${day.date} is outside the planning window.`,
        severity: "error"
      });
    }

    const dailyHours = day.blocks.reduce((sum, block) => sum + Number(block.duration_hours || 0), 0);
    const maxHours = availability.get(day.date) ?? day.assumed_available_hours;
    if (dailyHours > maxHours + 0.01) {
      violations.push({
        code: "daily_availability_exceeded",
        message: `${day.date} schedules ${dailyHours.toFixed(1)}h, above the assumed ${maxHours.toFixed(1)}h.`,
        severity: "error"
      });
    }

    for (const block of day.blocks) {
      const blockStart = parseDate(block.start);
      const blockEnd = parseDate(block.end);
      if (!blockStart || !blockEnd || blockEnd <= blockStart || block.duration_hours <= 0) {
        violations.push({
          code: "invalid_block_duration",
          message: `${block.description || block.id} has an invalid time range or duration.`,
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

      if (block.task_id) {
        blocksByTask.set(block.task_id, (blocksByTask.get(block.task_id) ?? 0) + 1);
        const deadline = taskDeadlines.get(block.task_id);
        if (deadline && blockEnd && blockEnd > deadline) {
          violations.push({
            code: "block_after_deadline",
            message: `${block.task_name ?? block.task_id} has work scheduled after its deadline.`,
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
