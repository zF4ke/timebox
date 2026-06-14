export type AgentName =
  | "Deadline Agent"
  | "Grade Agent"
  | "Effort Agent"
  | "Wellbeing Agent"
  | "Risk Agent";

export type Approval = "approve" | "approve_with_minor_concerns" | "reject";
export type Severity = "none" | "minor" | "major" | "critical";

export interface PlanningWindowOverride {
  startDate?: string;
  endDate?: string;
}

export interface PlanningRequest {
  userInput: string;
  quorum?: number;
  maxIterations?: number;
  timezone?: string;
  model?: string;
  evaluatorModel?: string;
  planningWindowOverride?: PlanningWindowOverride;
  /**
   * Run the LLM schedule evaluator after planning. Defaults to true.
   * Interactive planner runs pass false so the diagnostic score (and its
   * extra LLM call / cost) stays exclusive to the benchmarking section.
   */
  evaluate?: boolean;
}

export interface LlmCallTrace {
  id: string;
  schemaName: string;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptChars: number;
  completionChars: number;
  maxCompletionTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  usageSource: "provider" | "estimated";
  estimatedCostUsd: number | null;
}

export interface PlanningUsageSummary {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  calls: LlmCallTrace[];
}

export interface PlannerDefaults {
  quorum: number;
  maxIterations: number;
  timezone: string;
  model: string;
  evaluatorModel: string;
  hasApiKey: boolean;
}

export interface PlanningWindow {
  start_date: string;
  end_date: string;
  reason: string;
}

export interface InferredAvailability {
  date_range: string;
  assumption: string;
  estimated_available_hours_per_day: number;
  confidence: string;
}

export interface TaskInfo {
  task_id: string;
  name: string;
  raw_mentions: string[];
  inferred_deadline: string | null;
  uncertainties: string[];
}

export interface InterpreterOutput {
  current_date: string;
  planning_window: PlanningWindow;
  inferred_availability: InferredAvailability[];
  fixed_commitments: string[];
  student_state: {
    sleep: string;
    energy: string;
    confidence: string;
  };
  tasks: TaskInfo[];
  assumptions: string[];
}

export interface SpecialistTaskView {
  task_id: string;
  task_name: string;
  assessment: string;
  concerns: string[];
  recommendations: string[];
  estimated_duration_hours?: number;
  confidence?: string;
  suggested_subtasks?: string[];
}

export interface SpecialistAgentView {
  agent: AgentName;
  task_views: SpecialistTaskView[];
  overall_comment: string;
}

export interface CalendarBlock {
  id: string;
  task_id: string | null;
  task_name: string | null;
  type: "work" | "buffer" | "fixed" | "break";
  start: string;
  end: string;
  duration_hours: number;
  description: string;
  reasoning: string;
}

export interface CalendarDay {
  date: string;
  day_name: string;
  assumed_available_hours: number;
  day_reasoning: string;
  blocks: CalendarBlock[];
}

export interface CalendarCompromise {
  conflict: string;
  resolution: string;
}

export interface CalendarProposal {
  calendar_version: number;
  planning_window: PlanningWindow;
  overall_strategy: string[];
  days: CalendarDay[];
  compromises: CalendarCompromise[];
  known_weaknesses: string[];
  changes_from_previous?: Array<{
    change: string;
    reason: string;
  }>;
  unresolved_critiques?: Array<{
    agent: AgentName;
    severity: Severity;
    issue: string;
    planner_response: string;
  }>;
}

export interface CritiqueIssue {
  issue: string;
  severity: Severity;
  affected_tasks: string[];
  affected_days: string[];
  suggested_fix: string;
}

export interface AgentCritique {
  agent: AgentName;
  calendar_version: number;
  approval: Approval;
  severity: Severity;
  critiques: CritiqueIssue[];
  acknowledged_compromises: string[];
  overall_comment: string;
}

export interface ConstraintValidation {
  valid: boolean;
  violations: Array<{
    code: string;
    message: string;
    severity: "error";
  }>;
}

export type EvaluationDimension =
  | "requirement_match"
  | "deadline_safety"
  | "workload_realism"
  | "academic_priority"
  | "wellbeing_balance"
  | "risk_resilience";

export interface ScheduleEvaluationScore {
  dimension: EvaluationDimension;
  score: number;
  rationale: string;
}

export type HardMetricName =
  | "generation_time_seconds"
  | "rejection_count"
  | "critical_count"
  | "major_count"
  | "deadline_violation_count"
  | "task_coverage_ratio"
  | "availability_overrun_hours";

export interface HardMetricResult {
  name: HardMetricName;
  value: number;
  score: number;
  explanation: string;
}

export interface HardMetricsEvaluation {
  score: number;
  metrics: HardMetricResult[];
}

export interface ScheduleEvaluation {
  evaluator: "Schedule Evaluator";
  calendar_version: number;
  planner_model: string;
  evaluator_model: string;
  overall_score: number;
  model_score: number;
  hard_score: number;
  hard_metrics: HardMetricsEvaluation;
  dimension_scores: ScheduleEvaluationScore[];
  strengths: string[];
  weaknesses: string[];
  comparison_notes: string[];
  recommendation: string;
}

export interface CalendarVersionRecord {
  calendar: CalendarProposal;
  critiques: AgentCritique[];
  validation: ConstraintValidation;
  approvals: number;
  hasCritical: boolean;
}

export interface PlanningResult {
  runId: string;
  createdAt: string;
  request: PlanningRequest;
  stopReason: string;
  interpreterOutput: InterpreterOutput;
  agentViews: SpecialistAgentView[];
  calendarVersions: CalendarVersionRecord[];
  finalCalendar: CalendarProposal;
  critiques: AgentCritique[];
  validation: ConstraintValidation;
  /** Diagnostic schedule score. Only computed for benchmark runs and imports. */
  evaluation?: ScheduleEvaluation;
  usage: PlanningUsageSummary;
  exports: {
    json: string;
    ics: string;
  };
}

export interface BenchmarkScenarioSummary {
  id: string;
  promptFile: string;
  difficulty: "easy" | "medium" | "challenging";
  title: string;
}

export interface BenchmarkMistake {
  code: string;
  severity: "minor" | "major" | "critical";
  message: string;
  evidence: string;
}

export interface BenchmarkScore {
  score: number;
  expectedTaskCoverage: number;
  deadlineDiscipline: number;
  availabilityDiscipline: number;
  fixedCommitmentRespect: number;
  wellbeingRespect: number;
  revisionEfficiency: number;
  mistakeCount: number;
  mistakes: BenchmarkMistake[];
}

export interface BenchmarkRunSummary {
  scenarioId: string;
  scenarioTitle: string;
  difficulty: "easy" | "medium" | "challenging";
  model: string;
  quorum: number;
  maxIterations: number;
  status: "ok" | "error";
  overallScore: number | null;
  deterministicScore: number | null;
  modelScore: number | null;
  hardScore: number | null;
  approvals: number | null;
  iterations: number | null;
  generationTimeSeconds: number | null;
  estimatedCostUsd: number | null;
  costSource: "traced" | "legacy_estimate" | null;
  totalTokens: number | null;
  mistakeCount: number;
  criticalMistakeCount: number;
  /** Deterministic mistake labels for this run, used to aggregate common failures. */
  mistakes: BenchmarkMistake[];
  /** The fixed judge model that scored this run (may differ from the model under test). */
  evaluatorModel: string | null;
  jsonPath: string;
  icsPath: string;
  error: string;
}

export interface BenchmarkAggregate {
  model: string;
  evaluatorModel: string | null;
  quorum: number;
  maxIterations: number;
  runCount: number;
  okCount: number;
  averageOverallScore: number | null;
  averageDeterministicScore: number | null;
  averageCostUsd: number | null;
  averageTokens: number | null;
  averageIterations: number | null;
  averageGenerationTimeSeconds: number | null;
  costBenefitScore: number | null;
  criticalMistakes: number;
  totalMistakes: number;
}

export interface BenchmarkExperiment {
  id: string;
  createdAt: string;
  resultsDir: string;
  runs: BenchmarkRunSummary[];
  aggregates: BenchmarkAggregate[];
  /** Fixed judge model used to score every run in this experiment. */
  evaluatorModel?: string;
  /** Fixed judge models used to score every generated schedule in this experiment. */
  evaluatorModels?: string[];
  /** Hash of the prompt files in effect when this experiment ran. */
  promptHash?: string;
  /** Dollar cap requested for this experiment, if any. */
  budgetUsd?: number;
  /** True if the experiment was halted early by the budget cap. */
  stoppedByBudget?: boolean;
}

export interface BenchmarkRequest {
  models: string[];
  quorums: number[];
  maxIterations: number[];
  scenarios: string[];
  outDir?: string;
  delayMs?: number;
  retries?: number;
  forceFree?: boolean;
  /** Fixed judge model that scores every run. Defaults to the configured evaluator. */
  evaluatorModel?: string;
  /** Fixed judge models that each score the same generated schedule. */
  evaluatorModels?: string[];
  /** Resume into outDir by skipping run rows that are already present. */
  skipExistingRuns?: boolean;
  /** Optional hard dollar cap. The matrix stops before a run that would exceed it. */
  maxBudgetUsd?: number;
}

export interface ClearBenchmarkResult {
  success: boolean;
  cleared: string[];
  errors: string[];
}

export interface PromptFile {
  name: string;
  path: string;
  category: "scenario" | "agent";
}

export interface PromptCategory {
  name: string;
  category: "scenario" | "agent";
  prompts: PromptFile[];
}

export type BenchmarkProgressPhase =
  | "start"
  | "run_start"
  | "run_done"
  | "run_error"
  | "complete"
  | "error";

export interface BenchmarkProgressEvent {
  clientRunId?: string;
  phase: BenchmarkProgressPhase;
  current: number;
  total: number;
  summary: string;
  run?: BenchmarkRunSummary;
  timestamp: string;
}

export type ProgressPhase =
  | "interpreter"
  | "specialist"
  | "planner"
  | "critique"
  | "validate"
  | "evaluate"
  | "decision"
  | "complete"
  | "error";

export type ProgressStatus = "start" | "done";

export interface ProgressEvent {
  clientRunId?: string;
  phase: ProgressPhase;
  status: ProgressStatus;
  iteration?: number;
  agent?: string;
  summary?: string;
  timestamp: string;
}

export interface SavedCalendar {
  id: string;
  name: string;
  createdAt: string;
  result: PlanningResult;
}

export interface AppConfig {
  quorum: number;
  model: string;
  evaluatorModel?: string;
  apiKey?: string;
  maxIterations?: number;
}

export interface PlannerApi {
  runPlanner(request: PlanningRequest, clientRunId?: string): Promise<PlanningResult>;
  cancelPlanner(): Promise<void>;
  getDefaults(): Promise<PlannerDefaults>;
  onProgress(cb: (event: ProgressEvent) => void): () => void;
  listCalendars(): Promise<SavedCalendar[]>;
  saveCalendar(name: string, result: PlanningResult): Promise<SavedCalendar>;
  loadCalendar(id: string): Promise<SavedCalendar | null>;
  deleteCalendar(id: string): Promise<boolean>;
  importFile(): Promise<PlanningResult | null>;
  getConfig(): Promise<AppConfig>;
  setConfig(config: AppConfig): Promise<void>;
  parseImport(content: string, filename: string): Promise<PlanningResult>;
  listBenchmarkExperiments(): Promise<BenchmarkExperiment[]>;
  openBenchmarkRun(jsonPath: string, icsPath: string): Promise<PlanningResult | null>;
  clearBenchmarkExperiments(): Promise<ClearBenchmarkResult>;
  listBenchmarkScenarios(): Promise<BenchmarkScenarioSummary[]>;
  listPrompts(): Promise<PromptCategory[]>;
  readPrompt(path: string): Promise<string>;
  runBenchmark(request: BenchmarkRequest, clientRunId?: string): Promise<BenchmarkExperiment>;
  cancelBenchmark(): Promise<void>;
  onBenchmarkProgress(cb: (event: BenchmarkProgressEvent) => void): () => void;
}

declare global {
  interface Window {
    plannerApi: PlannerApi;
  }
}
