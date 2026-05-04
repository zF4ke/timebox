import { contextBridge, ipcRenderer } from "electron";
import type { PlannerApi, PlannerDefaults, PlanningRequest, PlanningResult } from "../shared/types";

const api: PlannerApi = {
  runPlanner(request: PlanningRequest): Promise<PlanningResult> {
    return ipcRenderer.invoke("planner:run", request) as Promise<PlanningResult>;
  },
  getDefaults(): Promise<PlannerDefaults> {
    return ipcRenderer.invoke("planner:defaults") as Promise<PlannerDefaults>;
  }
};

contextBridge.exposeInMainWorld("plannerApi", api);
