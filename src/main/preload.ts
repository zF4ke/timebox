import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  BenchmarkExperiment,
  BenchmarkProgressEvent,
  BenchmarkRequest,
  BenchmarkScenarioSummary,
  PlannerApi,
  PlannerDefaults,
  PlanningRequest,
  PlanningResult,
  ProgressEvent,
  SavedCalendar
} from "../shared/types";


const api: PlannerApi = {
  runPlanner(request: PlanningRequest, clientRunId?: string): Promise<PlanningResult> {
    return ipcRenderer.invoke("planner:run", request, clientRunId) as Promise<PlanningResult>;
  },
  cancelPlanner(): Promise<void> {
    return ipcRenderer.invoke("planner:cancel") as Promise<void>;
  },
  getDefaults(): Promise<PlannerDefaults> {
    return ipcRenderer.invoke("planner:defaults") as Promise<PlannerDefaults>;
  },
  onProgress(cb: (event: ProgressEvent) => void): () => void {
    const listener = (_e: unknown, payload: ProgressEvent) => cb(payload);
    ipcRenderer.on("planner:progress", listener);
    return () => ipcRenderer.off("planner:progress", listener);
  },
  listCalendars(): Promise<SavedCalendar[]> {
    return ipcRenderer.invoke("storage:list") as Promise<SavedCalendar[]>;
  },
  saveCalendar(name: string, result: PlanningResult): Promise<SavedCalendar> {
    return ipcRenderer.invoke("storage:save", name, result) as Promise<SavedCalendar>;
  },
  loadCalendar(id: string): Promise<SavedCalendar | null> {
    return ipcRenderer.invoke("storage:load", id) as Promise<SavedCalendar | null>;
  },
  deleteCalendar(id: string): Promise<boolean> {
    return ipcRenderer.invoke("storage:delete", id) as Promise<boolean>;
  },
  importFile(): Promise<PlanningResult | null> {
    return ipcRenderer.invoke("storage:import") as Promise<PlanningResult | null>;
  },
  getConfig(): Promise<AppConfig> {
    return ipcRenderer.invoke("config:get") as Promise<AppConfig>;
  },
  setConfig(config: AppConfig): Promise<void> {
    return ipcRenderer.invoke("config:set", config) as Promise<void>;
  },
  parseImport(content: string, filename: string): Promise<PlanningResult> {
    return ipcRenderer.invoke("import:parse", content, filename) as Promise<PlanningResult>;
  },
  listBenchmarkExperiments(): Promise<BenchmarkExperiment[]> {
    return ipcRenderer.invoke("benchmark:list") as Promise<BenchmarkExperiment[]>;
  },
  openBenchmarkRun(jsonPath: string, icsPath: string): Promise<PlanningResult | null> {
    return ipcRenderer.invoke("benchmark:openRun", jsonPath, icsPath) as Promise<PlanningResult | null>;
  },
  clearBenchmarkExperiments(): Promise<void> {
    return ipcRenderer.invoke("benchmark:clear") as Promise<void>;
  },
  listBenchmarkScenarios(): Promise<BenchmarkScenarioSummary[]> {
    return ipcRenderer.invoke("benchmark:scenarios") as Promise<BenchmarkScenarioSummary[]>;
  },
  runBenchmark(request: BenchmarkRequest, clientRunId?: string): Promise<BenchmarkExperiment> {
    return ipcRenderer.invoke("benchmark:run", request, clientRunId) as Promise<BenchmarkExperiment>;
  },
  cancelBenchmark(): Promise<void> {
    return ipcRenderer.invoke("benchmark:cancel") as Promise<void>;
  },
  onBenchmarkProgress(cb: (event: BenchmarkProgressEvent) => void): () => void {
    const listener = (_e: unknown, payload: BenchmarkProgressEvent) => cb(payload);
    ipcRenderer.on("benchmark:progress", listener);
    return () => ipcRenderer.off("benchmark:progress", listener);
  }
};

contextBridge.exposeInMainWorld("plannerApi", api);
