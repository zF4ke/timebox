import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { importFromIcs, importFromJson } from "./import";
import type { PlanningResult } from "../shared/types";
import { loadConfig, saveConfig } from "./config";
import { clearBenchmarkExperiments, listBenchmarkExperiments, loadScenarios } from "./benchmarkAnalytics";
import { runBenchmarkExperiment } from "./benchmark";
import { getPlannerDefaults, runPlanningPipeline } from "./planner";
import { deleteCalendar, listCalendars, loadCalendar, saveCalendar } from "./storage";
import type { AppConfig, BenchmarkProgressEvent, BenchmarkRequest, PlanningRequest, ProgressEvent } from "../shared/types";


const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let activePlannerController: AbortController | null = null;
let activeBenchmarkController: AbortController | null = null;

function appIconPath(): string {
  return path.join(__dirname, "../../assets/app_icon.ico");
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#fafafa",
    title: "Timebox",
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
  }
}

ipcMain.handle("planner:run", async (event, request: PlanningRequest, clientRunId?: string) => {
  activePlannerController?.abort();
  const controller = new AbortController();
  activePlannerController = controller;
  try {
    return await runPlanningPipeline(request, (ev) => {
      const payload: ProgressEvent = { ...ev, clientRunId, timestamp: new Date().toISOString() };
      if (!event.sender.isDestroyed()) {
        event.sender.send("planner:progress", payload);
      }
    }, controller.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[planner] error — ${message}`);
    if (!event.sender.isDestroyed()) {
      const payload: ProgressEvent = {
        clientRunId,
        phase: "error",
        status: "done",
        summary: message,
        timestamp: new Date().toISOString()
      };
      event.sender.send("planner:progress", payload);
    }
    throw err;
  } finally {
    if (activePlannerController === controller) {
      activePlannerController = null;
    }
  }
});

ipcMain.handle("planner:cancel", async () => {
  console.log("[main] cancel requested");
  activePlannerController?.abort();
});

ipcMain.handle("planner:defaults", async () => {
  return getPlannerDefaults();
});

ipcMain.handle("storage:list", async () => {
  return listCalendars();
});

ipcMain.handle("storage:save", async (_event, name: string, result: unknown) => {
  return saveCalendar(name, result as ReturnType<typeof runPlanningPipeline> extends Promise<infer R> ? R : never);
});

ipcMain.handle("storage:load", async (_event, id: string) => {
  return loadCalendar(id);
});

ipcMain.handle("storage:delete", async (_event, id: string) => {
  return deleteCalendar(id);
});

ipcMain.handle("config:get", async () => {
  return loadConfig();
});

ipcMain.handle("config:set", async (_event, config: AppConfig) => {
  saveConfig(config);
});

ipcMain.handle("import:parse", async (_event, content: string, filename: string): Promise<PlanningResult> => {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".ics") {
    return importFromIcs(content);
  }
  return importFromJson(content);
});

ipcMain.handle("benchmark:list", async () => {
  return listBenchmarkExperiments();
});

ipcMain.handle("benchmark:openRun", async (_event, jsonPath: string, icsPath: string): Promise<PlanningResult | null> => {
  try {
    if (!jsonPath || !fs.existsSync(jsonPath)) {
      return null;
    }
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    // Stored benchmark JSON is a PlanningResult without the `exports` field.
    const result = (parsed.result ?? parsed) as Omit<PlanningResult, "exports">;
    const ics = icsPath && fs.existsSync(icsPath) ? fs.readFileSync(icsPath, "utf-8") : "";
    return { ...result, exports: { json: raw, ics } };
  } catch (err) {
    console.error("[main] benchmark:openRun failed:", err);
    return null;
  }
});

ipcMain.handle("benchmark:clear", async () => {
  return clearBenchmarkExperiments();
});

ipcMain.handle("benchmark:scenarios", async () => {
  return loadScenarios().map((scenario) => ({
    id: scenario.id,
    promptFile: scenario.promptFile,
    difficulty: scenario.difficulty,
    title: scenario.title
  }));
});

ipcMain.handle("benchmark:run", async (event, request: BenchmarkRequest, clientRunId?: string) => {
  activeBenchmarkController?.abort();
  const controller = new AbortController();
  activeBenchmarkController = controller;
  try {
    return await runBenchmarkExperiment(request, (ev) => {
      const payload: BenchmarkProgressEvent = { ...ev, clientRunId, timestamp: new Date().toISOString() };
      if (!event.sender.isDestroyed()) {
        event.sender.send("benchmark:progress", payload);
      }
    }, controller.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] error — ${message}`);
    if (!event.sender.isDestroyed()) {
      const payload: BenchmarkProgressEvent = {
        clientRunId,
        phase: "error",
        current: 0,
        total: 0,
        summary: message,
        timestamp: new Date().toISOString()
      };
      event.sender.send("benchmark:progress", payload);
    }
    throw err;
  } finally {
    if (activeBenchmarkController === controller) {
      activeBenchmarkController = null;
    }
  }
});

ipcMain.handle("benchmark:cancel", async () => {
  console.log("[main] benchmark cancel requested");
  activeBenchmarkController?.abort();
});

function findPromptDirs(): { scenario: string | null; agent: string | null } {
  const appPath = app.getAppPath();
  const candidates = {
    scenario: [
      path.join(appPath, "prompts"),
      path.join(process.cwd(), "prompts")
    ],
    agent: [
      path.join(appPath, "src", "main", "prompts"),
      path.join(appPath, "dist-electron", "main", "prompts"),
      path.join(process.cwd(), "src", "main", "prompts")
    ]
  };
  return {
    scenario: candidates.scenario.find((d) => fs.existsSync(d)) ?? null,
    agent: candidates.agent.find((d) => fs.existsSync(d)) ?? null
  };
}

ipcMain.handle("prompts:list", async () => {
  const dirs = findPromptDirs();
  const categories: { name: string; category: "scenario" | "agent"; prompts: { name: string; path: string; category: "scenario" | "agent" }[] }[] = [];

  if (dirs.scenario) {
    const prompts = fs.readdirSync(dirs.scenario)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => ({ name: f, path: path.join(dirs.scenario as string, f), category: "scenario" as const }));
    if (prompts.length > 0) {
      categories.push({ name: "Scenario prompts", category: "scenario", prompts });
    }
  }

  if (dirs.agent) {
    const prompts = fs.readdirSync(dirs.agent)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ name: f, path: path.join(dirs.agent as string, f), category: "agent" as const }));
    if (prompts.length > 0) {
      categories.push({ name: "Agent prompts", category: "agent", prompts });
    }
  }

  return categories;
});

ipcMain.handle("prompts:read", async (_event, filePath: string) => {
  // Security: only allow reading from the project's prompts directories
  const resolved = path.resolve(filePath);
  const dirs = findPromptDirs();
  const allowedRoots = [dirs.scenario, dirs.agent].filter(Boolean) as string[];
  const isAllowed = allowedRoots.some((root) => resolved.startsWith(root));
  if (!isAllowed) {
    throw new Error("Access denied: path outside allowed prompt directories");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("Prompt file not found");
  }
  return fs.readFileSync(resolved, "utf-8");
});

ipcMain.handle("storage:import", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const { filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [
      { name: "Calendar files", extensions: ["json", "ics"] },
      { name: "JSON", extensions: ["json"] },
      { name: "ICS", extensions: ["ics"] }
    ]
  });
  if (!filePaths || filePaths.length === 0) return null;
  const content = fs.readFileSync(filePaths[0], "utf-8");
  const ext = path.extname(filePaths[0]).toLowerCase();
  if (ext === ".ics") {
    return importFromIcs(content);
  }
  return importFromJson(content);
});

if (process.platform === "win32") {
  app.setAppUserModelId("com.aasma.timebox");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
