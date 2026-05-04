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
  planningWindowOverride?: PlanningWindowOverride;
}

export interface PlannerDefaults {
  quorum: number;
  maxIterations: number;
  timezone: string;
  model: string;
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
  exports: {
    json: string;
    ics: string;
  };
}

export type ProgressPhase =
  | "interpreter"
  | "specialist"
  | "planner"
  | "critique"
  | "validate"
  | "decision"
  | "complete"
  | "error";

export type ProgressStatus = "start" | "done";

export interface ProgressEvent {
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

export interface PlannerApi {
  runPlanner(request: PlanningRequest): Promise<PlanningResult>;
  cancelPlanner(): Promise<void>;
  getDefaults(): Promise<PlannerDefaults>;
  onProgress(cb: (event: ProgressEvent) => void): () => void;
  listCalendars(): Promise<SavedCalendar[]>;
  saveCalendar(name: string, result: PlanningResult): Promise<SavedCalendar>;
  loadCalendar(id: string): Promise<SavedCalendar | null>;
  deleteCalendar(id: string): Promise<boolean>;
  importFile(): Promise<PlanningResult | null>;
}

declare global {
  interface Window {
    plannerApi: PlannerApi;
  }
}
