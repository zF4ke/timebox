import type {
  AgentCritique,
  CalendarProposal,
  ConstraintValidation,
  HardMetricResult,
  HardMetricsEvaluation,
  InterpreterOutput,
  Severity
} from "../shared/types";

interface HardMetricInput {
  calendar: CalendarProposal;
  critiques: AgentCritique[];
  validation: ConstraintValidation;
  interpreterOutput: InterpreterOutput;
  generationTimeSeconds: number;
}

export function evaluateHardMetrics(input: HardMetricInput): HardMetricsEvaluation {
  const metrics: HardMetricResult[] = [
    generationTimeMetric(input.generationTimeSeconds),
    rejectionCountMetric(input.critiques),
    severityCountMetric(input.critiques, "critical"),
    severityCountMetric(input.critiques, "major"),
    deadlineViolationMetric(input.validation),
    taskCoverageMetric(input.calendar, input.interpreterOutput),
    availabilityOverrunMetric(input.calendar)
  ];

  const score = round1(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length);
  return { score, metrics };
}

function generationTimeMetric(seconds: number): HardMetricResult {
  const value = round1(Math.max(0, seconds));
  return {
    name: "generation_time_seconds",
    value,
    score: scoreLowerIsBetter(value, 60, 300),
    explanation: `${value}s from run start to final schedule selection.`
  };
}

function rejectionCountMetric(critiques: AgentCritique[]): HardMetricResult {
  const value = critiques.filter((critique) => critique.approval === "reject").length;
  return {
    name: "rejection_count",
    value,
    score: scoreLowerIsBetter(value, 0, 5),
    explanation: `${value} specialist agent(s) rejected the final calendar.`
  };
}

function severityCountMetric(critiques: AgentCritique[], severity: "critical" | "major"): HardMetricResult {
  const value = countSeverity(critiques, severity);
  return {
    name: severity === "critical" ? "critical_count" : "major_count",
    value,
    score: severity === "critical" ? scoreLowerIsBetter(value, 0, 3) : scoreLowerIsBetter(value, 0, 5),
    explanation: `${value} ${severity} issue(s) were raised in final critiques.`
  };
}

function deadlineViolationMetric(validation: ConstraintValidation): HardMetricResult {
  const value = validation.violations.filter((violation) => violation.code === "block_after_deadline").length;
  return {
    name: "deadline_violation_count",
    value,
    score: scoreLowerIsBetter(value, 0, 3),
    explanation: `${value} scheduled work block(s) end after their task deadline.`
  };
}

function taskCoverageMetric(calendar: CalendarProposal, interpreterOutput: InterpreterOutput): HardMetricResult {
  const taskIds = interpreterOutput.tasks.map((task) => task.task_id);
  const scheduled = new Set(
    calendar.days
      .flatMap((day) => day.blocks)
      .filter((block) => block.type === "work" && block.task_id)
      .map((block) => block.task_id!)
  );
  const covered = taskIds.filter((taskId) => scheduled.has(taskId)).length;
  const value = taskIds.length === 0 ? 1 : round2(covered / taskIds.length);

  return {
    name: "task_coverage_ratio",
    value,
    score: round1(value * 100),
    explanation: `${covered}/${taskIds.length} inferred task(s) received at least one work block.`
  };
}

function availabilityOverrunMetric(calendar: CalendarProposal): HardMetricResult {
  const value = round1(
    calendar.days.reduce((total, day) => {
      const scheduled = day.blocks.reduce((sum, block) => sum + (block.duration_hours || 0), 0);
      return total + Math.max(0, scheduled - day.assumed_available_hours);
    }, 0)
  );

  return {
    name: "availability_overrun_hours",
    value,
    score: scoreLowerIsBetter(value, 0, 6),
    explanation: `${value}h scheduled above the planner's assumed available hours.`
  };
}

function countSeverity(critiques: AgentCritique[], severity: Severity): number {
  return critiques.reduce((count, critique) => {
    const ownSeverity = critique.severity === severity ? 1 : 0;
    const issueSeverity = critique.critiques.filter((issue) => issue.severity === severity).length;
    return count + ownSeverity + issueSeverity;
  }, 0);
}

function scoreLowerIsBetter(value: number, best: number, worst: number): number {
  if (value <= best) return 100;
  if (value >= worst) return 0;
  return round1(100 - ((value - best) / (worst - best)) * 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
