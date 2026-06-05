import type {
  BenchmarkMistake,
  BenchmarkScore,
  CalendarBlock,
  PlanningResult
} from "../shared/types";

export interface BenchmarkScenario {
  id: string;
  promptFile: string;
  title: string;
  difficulty: "easy" | "medium" | "challenging";
  expectedTaskKeywords: string[][];
  avoidLateNight: boolean;
  minWorkBlocks: number;
}

export function scoreBenchmarkResult(result: PlanningResult, scenario: BenchmarkScenario): BenchmarkScore {
  const mistakes: BenchmarkMistake[] = [];
  const blocks = allBlocks(result);
  const workBlocks = blocks.filter((block) => block.type === "work");
  const textCorpus = buildCorpus(result);

  const expectedTaskCoverage = scoreExpectedTasks(textCorpus, scenario.expectedTaskKeywords, mistakes);
  const deadlineDiscipline = scoreDeadlineDiscipline(result, mistakes);
  const availabilityDiscipline = scoreAvailabilityDiscipline(result, mistakes);
  const fixedCommitmentRespect = scoreFixedCommitmentRespect(result, mistakes);
  const wellbeingRespect = scoreWellbeing(result, scenario, workBlocks, mistakes);
  const revisionEfficiency = scoreRevisionEfficiency(result, mistakes);

  if (workBlocks.length < scenario.minWorkBlocks) {
    const deficit = scenario.minWorkBlocks - workBlocks.length;
    mistakes.push({
      code: "too_few_work_blocks",
      severity: deficit <= 1 ? "minor" : "major",
      message: `Expected at least ${scenario.minWorkBlocks} work blocks for this scenario, found ${workBlocks.length}.`,
      evidence: scenario.id
    });
  }

  // Quality Score v2. Weights reallocated by criterion validity: each component's
  // empirical correlation with the independent LLM judge on the 2026-06-05 run
  // (84 plans). Availability discipline (r=.41, the strongest predictor) and
  // deadline discipline (r=.28, a hard constraint) carry the most weight; expected-
  // task coverage (r=.05) and wellbeing (r=.04) are near-constant / low-signal and
  // are down-weighted but kept above zero so they retain teeth. This holds under
  // leave-one-scenario-out (mean validity .40), i.e. it is not fit to noise.
  let score = round1(
    expectedTaskCoverage * 0.12 +
      deadlineDiscipline * 0.25 +
      availabilityDiscipline * 0.25 +
      fixedCommitmentRespect * 0.13 +
      wellbeingRespect * 0.1 +
      revisionEfficiency * 0.15
  );

  // Critical-violation gate. The weighted sum alone let a plan with a blown
  // deadline still score ~92 (a validity bug: the headline number disagreed with
  // an objectively broken plan). Any critical mistake caps the score at 70, with
  // -8 per additional critical, so a hard correctness failure can never read green.
  const criticalCount = mistakes.filter((mistake) => mistake.severity === "critical").length;
  if (criticalCount > 0) {
    score = clampScore(Math.min(score, 70 - (criticalCount - 1) * 8));
  }

  return {
    score,
    expectedTaskCoverage,
    deadlineDiscipline,
    availabilityDiscipline,
    fixedCommitmentRespect,
    wellbeingRespect,
    revisionEfficiency,
    mistakeCount: mistakes.length,
    mistakes
  };
}

function scoreExpectedTasks(
  corpus: string,
  expectedTaskKeywords: string[][],
  mistakes: BenchmarkMistake[]
): number {
  if (expectedTaskKeywords.length === 0) {
    return 100;
  }

  let matched = 0;
  for (const group of expectedTaskKeywords) {
    const found = group.every((keyword) => corpus.includes(keyword.toLowerCase()));
    if (found) {
      matched += 1;
    } else {
      mistakes.push({
        code: "missing_expected_task",
        severity: "critical",
        message: `Expected task/topic not represented: ${group.join(" ")}.`,
        evidence: group.join(" ")
      });
    }
  }

  return round1((matched / expectedTaskKeywords.length) * 100);
}

function scoreDeadlineDiscipline(result: PlanningResult, mistakes: BenchmarkMistake[]): number {
  const deadlineViolations = result.validation.violations.filter((violation) =>
    violation.code.includes("deadline")
  );

  for (const violation of deadlineViolations) {
    mistakes.push({
      code: violation.code,
      severity: violation.code === "block_after_deadline" ? "critical" : "major",
      message: violation.message,
      evidence: violation.code
    });
  }

  const finalCriticals = result.critiques.reduce(
    (count, critique) =>
      count + critique.critiques.filter((issue) => issue.severity === "critical").length + (critique.severity === "critical" ? 1 : 0),
    0
  );
  if (finalCriticals > 0) {
    mistakes.push({
      code: "final_critical_critiques",
      severity: "critical",
      message: `${finalCriticals} critical critique(s) remained on the selected calendar.`,
      evidence: result.stopReason
    });
  }

  return clampScore(100 - deadlineViolations.length * 35 - finalCriticals * 15);
}

function scoreAvailabilityDiscipline(result: PlanningResult, mistakes: BenchmarkMistake[]): number {
  let overrunHours = 0;
  for (const day of result.finalCalendar.days) {
    const scheduled = day.blocks.reduce((sum, block) => sum + (block.duration_hours || 0), 0);
    const overrun = Math.max(0, scheduled - day.assumed_available_hours);
    if (overrun > 0) {
      overrunHours += overrun;
      mistakes.push({
        code: "availability_overrun",
        severity: overrun >= 3 ? "major" : "minor",
        message: `${day.date} schedules ${round1(overrun)}h above assumed availability.`,
        evidence: `${day.date}: ${scheduled}h scheduled / ${day.assumed_available_hours}h available`
      });
    }
  }

  const restBlocks = result.validation.violations.filter((violation) => violation.code === "rest_block_not_allowed");
  for (const violation of restBlocks) {
    mistakes.push({
      code: "rest_block_not_allowed",
      severity: "minor",
      message: violation.message,
      evidence: violation.code
    });
  }

  return clampScore(100 - overrunHours * 18 - restBlocks.length * 8);
}

function scoreFixedCommitmentRespect(result: PlanningResult, mistakes: BenchmarkMistake[]): number {
  const fixedCommitmentMentions = result.interpreterOutput.fixed_commitments.length;
  const hasFixedViolations = result.validation.violations.some((violation) => violation.code.includes("fixed"));

  if (hasFixedViolations) {
    mistakes.push({
      code: "fixed_commitment_conflict",
      severity: "major",
      message: "Validation detected a fixed-commitment issue.",
      evidence: result.validation.violations.map((violation) => violation.code).join(", ")
    });
  }

  if (fixedCommitmentMentions > 0 && !mentionsFixedCommitments(result)) {
    mistakes.push({
      code: "fixed_commitments_not_explained",
      severity: "minor",
      message: "Interpreter found fixed commitments, but the final calendar does not explain how they were respected.",
      evidence: result.interpreterOutput.fixed_commitments.slice(0, 3).join(" | ")
    });
    return 80;
  }

  return hasFixedViolations ? 45 : 100;
}

function scoreWellbeing(
  result: PlanningResult,
  scenario: BenchmarkScenario,
  workBlocks: CalendarBlock[],
  mistakes: BenchmarkMistake[]
): number {
  let penalty = 0;
  const lateBlocks = scenario.avoidLateNight
    ? workBlocks.filter((block) => {
        const end = new Date(block.end);
        return !Number.isNaN(end.getTime()) && end.getHours() >= 22;
      })
    : [];

  for (const block of lateBlocks) {
    const end = new Date(block.end);
    const severity = !Number.isNaN(end.getTime()) && end.getHours() >= 23 ? "major" : "minor";
    penalty += severity === "major" ? 25 : 15;
    mistakes.push({
      code: "late_work_when_avoided",
      severity,
      message: "Scenario asked to avoid late-night work, but a late work block was scheduled.",
      evidence: `${block.task_name ?? block.description}: ${block.start} -> ${block.end}`
    });
  }

  const wellbeingRejects = result.critiques.filter(
    (critique) => critique.agent === "Wellbeing Agent" && critique.approval === "reject"
  );
  if (wellbeingRejects.length > 0) {
    const hasSevereReject = wellbeingRejects.some(
      (critique) => critique.severity === "critical" || critique.severity === "major"
    );
    penalty += hasSevereReject ? 20 : 10;
    mistakes.push({
      code: "wellbeing_agent_rejected",
      severity: hasSevereReject ? "major" : "minor",
      message: "Wellbeing Agent rejected the selected calendar.",
      evidence: wellbeingRejects.map((critique) => critique.overall_comment).join(" | ")
    });
  }

  return clampScore(100 - penalty);
}

function scoreRevisionEfficiency(result: PlanningResult, mistakes: BenchmarkMistake[]): number {
  const iterations = result.calendarVersions.length || 1;
  const approvals = result.critiques.filter(
    (critique) => critique.approval === "approve" || critique.approval === "approve_with_minor_concerns"
  ).length;
  const accepted = !result.stopReason.toLowerCase().includes("maximum iterations");

  if (!accepted) {
    mistakes.push({
      code: "max_iterations_fallback",
      severity: "minor",
      message: "No calendar reached the acceptance rule before the max-iteration fallback.",
      evidence: result.stopReason
    });
  }

  if (approvals < (result.request.quorum ?? 5)) {
    const approvalDeficit = (result.request.quorum ?? 5) - approvals;
    mistakes.push({
      code: "quorum_not_reached",
      severity: approvalDeficit <= 1 ? "minor" : "major",
      message: `Selected calendar has ${approvals} approval(s), below quorum ${result.request.quorum ?? 5}.`,
      evidence: result.stopReason
    });
  }

  return clampScore((accepted ? 100 : 65) - Math.max(0, iterations - 1) * 12);
}

function buildCorpus(result: PlanningResult): string {
  const parts = [
    ...result.interpreterOutput.tasks.flatMap((task) => [task.name, ...task.raw_mentions]),
    ...result.finalCalendar.days.flatMap((day) =>
      day.blocks.flatMap((block) => [block.task_name ?? "", block.description, block.reasoning])
    ),
    ...result.finalCalendar.overall_strategy,
    ...result.finalCalendar.known_weaknesses
  ];
  return parts.join(" ").toLowerCase();
}

function allBlocks(result: PlanningResult): CalendarBlock[] {
  return result.finalCalendar.days.flatMap((day) => day.blocks);
}

function mentionsFixedCommitments(result: PlanningResult): boolean {
  const calendarText = [
    ...result.finalCalendar.overall_strategy,
    ...result.finalCalendar.days.map((day) => day.day_reasoning),
    ...result.finalCalendar.known_weaknesses
  ]
    .join(" ")
    .toLowerCase();
  return ["class", "work", "dentist", "shift", "commitment", "commute", "event"].some((word) =>
    calendarText.includes(word)
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, round1(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
