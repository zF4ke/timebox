import { contextBridge, ipcRenderer } from "electron";
import type {
  PlannerApi,
  PlannerDefaults,
  PlanningRequest,
  PlanningResult,
  ProgressEvent
} from "../shared/types";

const api: PlannerApi = {
  runPlanner(request: PlanningRequest): Promise<PlanningResult> {
    return ipcRenderer.invoke("planner:run", request) as Promise<PlanningResult>;
  },
  getDefaults(): Promise<PlannerDefaults> {
    return ipcRenderer.invoke("planner:defaults") as Promise<PlannerDefaults>;
  },
  onProgress(cb: (event: ProgressEvent) => void): () => void {
    const listener = (_e: unknown, payload: ProgressEvent) => cb(payload);
    ipcRenderer.on("planner:progress", listener);
    return () => ipcRenderer.off("planner:progress", listener);
  }
};

contextBridge.exposeInMainWorld("plannerApi", api);
